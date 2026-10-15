// hooks/useFeederData.js
// Dual-sync data hook for Firebase Realtime Database + Cloud Firestore
// Real hardware ultrasonic sensor data drives food level (NO hardcoded reductions)

import { useState, useEffect, useRef } from 'react';
import { ref, onValue, set, get, push, update } from 'firebase/database';
import {
  doc,
  setDoc,
  collection,
  addDoc,
  deleteDoc,
  updateDoc,
} from 'firebase/firestore';
import { db, firestore } from '../firebase/config';

/**
 * Calculates the next upcoming feed string from the live list of schedules for TODAY.
 * Once all of today's scheduled feeds have already passed (e.g. 4:00 PM schedule at 4:15 PM),
 * returns "Done Today" instead of repeating the already-passed 4:00 PM time.
 */
function computeNextFeed(schedList, vacationMode = false) {
  if (vacationMode) return 'Vacation';
  if (!schedList || schedList.length === 0) return '--:--';
  const activeScheds = schedList.filter((s) => s && s.active);
  if (activeScheds.length === 0) return 'Paused';

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const dayOfWeek = now.getDay(); // 0 = Sun, 1..5 = Mon..Fri, 6 = Sat

  // Filter schedules that apply to today
  const todaysScheds = activeScheds.filter((s) => {
    const freq = (s.frequency || 'Daily').trim();
    if (freq === 'Mon-Fri' && (dayOfWeek === 0 || dayOfWeek === 6)) return false;
    if (freq === 'Weekends' && dayOfWeek >= 1 && dayOfWeek <= 5) return false;
    return true;
  });

  if (todaysScheds.length === 0) return 'None Today';

  const parsed = todaysScheds
    .map((s) => {
      const cleanTime = (s.time || '00:00').trim();
      let [h, m] = cleanTime.split(':').map(Number);
      if (isNaN(h)) h = 0;
      if (isNaN(m)) m = 0;
      const ampm = (s.ampm || '').trim().toUpperCase();
      if (ampm === 'PM' && h < 12) h += 12;
      if (ampm === 'AM' && h === 12) h = 0;
      return {
        minutesFromMidnight: h * 60 + m,
        display: `${cleanTime} ${ampm}`.trim(),
      };
    })
    .sort((a, b) => a.minutesFromMidnight - b.minutesFromMidnight);

  // Find next feed later today (strictly after current time)
  const nextToday = parsed.find((p) => p.minutesFromMidnight > currentMinutes);
  if (nextToday) return nextToday.display;

  // All scheduled feeds for today have already completed
  return 'Done Today';
}

export default function useFeederData() {
  const [feederData, setFeederData] = useState({
    foodLevel: 100,
    foodDistanceCm: 1.0,
    sensorConnected: true,
    lastSensorPing: null,
    maxDistanceCm: 5.0,
    minDistanceCm: 1.0,
    portionSize: 1,
    servoStatus: 'Ready',
    nextFeed: '--:--',
    burnPerDay: 6,
    deviceOnline: true,
    vacationMode: false,
    lastDispense: { timestamp: Date.now() - 4 * 60 * 1000, servoSpin: '1.5s servo spin' },
  });

  const [schedules, setSchedules] = useState([]);
  const [foodHistory, setFoodHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  // Safety timer ref to prevent UI getting stuck if hardware is disconnected
  const safetyTimeoutRef = useRef(null);
  // Tracks when the user actually tapped "Feed Now" in this app session
  const lastTapTimeRef = useRef(0);

  // Re-evaluate nextFeed every 15 seconds so when the clock passes a schedule time
  // (e.g. 4:00 PM -> 4:01 PM), "Next Feed" updates automatically in real time
  useEffect(() => {
    const interval = setInterval(() => {
      setFeederData((prev) => {
        const updatedNext = computeNextFeed(schedules, prev.vacationMode);
        if (updatedNext === prev.nextFeed) return prev;
        return { ...prev, nextFeed: updatedNext };
      });
    }, 15000);
    return () => clearInterval(interval);
  }, [schedules]);

  // ── 1. Realtime Database Listeners (Fast hardware sync) ───────────
  useEffect(() => {
    const feederRef = ref(db, 'feeder');
    const unsub = onValue(
      feederRef,
      (snap) => {
        const val = snap.val();
        if (val) {
          setFeederData((prev) => {
            // Always derive nextFeed from the live schedules in /feeder/schedules
            const liveSchedList = val.schedules
              ? Object.entries(val.schedules).map(([id, data]) => ({ id, ...data }))
              : schedules;
            const nextFeedVal = computeNextFeed(liveSchedList, val.vacationMode ?? false);

            // Only show "Dispensing" if the user actually tapped Feed Now within the last 10s
            const isActivelyFeeding =
              lastTapTimeRef.current > 0 && Date.now() - lastTapTimeRef.current < 10000;
            const resolvedServoStatus =
              val.servoStatus === 'Dispensing' && !isActivelyFeeding
                ? 'Ready'
                : (val.servoStatus ?? 'Ready');

            // Auto-clean stale "Dispensing" value in Firebase so button is never stuck on startup
            if (val.servoStatus === 'Dispensing' && !isActivelyFeeding) {
              set(ref(db, 'feeder/servoStatus'), 'Ready').catch(() => {});
            }

            const updated = {
              foodLevel: typeof val.foodLevel === 'number' ? val.foodLevel : 100,
              foodDistanceCm: typeof val.foodDistanceCm === 'number' ? val.foodDistanceCm : null,
              sensorConnected: val.sensorConnected !== false,
              lastSensorPing: val.lastSensorPing ?? null,
              maxDistanceCm: val.maxDistanceCm ?? 5.0,
              minDistanceCm: val.minDistanceCm ?? 1.0,
              portionSize: val.portionSize ?? 1,
              servoStatus: resolvedServoStatus,
              nextFeed: nextFeedVal,
              burnPerDay: val.burnPerDay ?? 6,
              deviceOnline: val.deviceOnline ?? true,
              vacationMode: val.vacationMode ?? false,
              lastDispense: val.lastDispense ?? {
                timestamp: Date.now(),
                servoSpin: '1.5s servo spin',
              },
            };

            // Clear safety timeout once hardware finishes dispensing
            if (updated.servoStatus === 'Ready') {
              lastTapTimeRef.current = 0;
              if (safetyTimeoutRef.current) {
                clearTimeout(safetyTimeoutRef.current);
                safetyTimeoutRef.current = null;
              }
            }

            // Automatically sync real sensor data to Firestore document
            if (firestore && val.foodLevel != null) {
              syncToFirestore('main', {
                foodLevel: updated.foodLevel,
                foodDistanceCm: updated.foodDistanceCm,
                sensorConnected: updated.sensorConnected,
                servoStatus: updated.servoStatus,
                deviceOnline: updated.deviceOnline,
                updatedAt: Date.now(),
              });
            }

            return updated;
          });
        }
        setLoading(false);
      },
      (error) => {
        console.warn('RTDB onValue error:', error.message);
        setLoading(false);
      }
    );
    return () => {
      unsub();
      if (safetyTimeoutRef.current) clearTimeout(safetyTimeoutRef.current);
    };
  }, [schedules]);

  useEffect(() => {
    const schedRef = ref(db, 'feeder/schedules');
    const unsub = onValue(
      schedRef,
      (snap) => {
        const val = snap.val();
        if (val) {
          const list = Object.entries(val).map(([id, data]) => ({ id, ...data }));
          setSchedules(list);
          setFeederData((prev) => ({
            ...prev,
            nextFeed: computeNextFeed(list, prev.vacationMode),
          }));
        } else {
          setSchedules([]);
          setFeederData((prev) => ({
            ...prev,
            nextFeed: '--:--',
          }));
        }
      },
      (error) => {
        console.warn('RTDB schedules error:', error.message);
      }
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    const histRef = ref(db, 'feeder/foodHistory');
    const unsub = onValue(
      histRef,
      (snap) => {
        const val = snap.val();
        if (val) {
          const list = Object.entries(val)
            .map(([id, data]) => ({ id, ...data }))
            .sort((a, b) => a.timestamp - b.timestamp);
          setFoodHistory(list);
        } else {
          setFoodHistory([]);
        }
      },
      (error) => {
        console.warn('RTDB foodHistory error:', error.message);
      }
    );
    return () => unsub();
  }, []);

  // ── 2. Firestore Sync Helpers ──
  const syncToFirestore = async (path, data, isMerge = true) => {
    try {
      if (!firestore) return;
      const docRef = doc(firestore, 'feeder', path);
      await setDoc(docRef, data, { merge: isMerge });
    } catch (e) {
      console.warn('Firestore write warning:', e.message);
    }
  };

  // ── Action helpers ──────────────────────────────────────────────

  /**
   * Trigger an immediate manual feed dispense.
   * Sends the command to the ESP8266 via Firebase.
   * NO fake reductions: ESP8266 rotates servo, pings ultrasonic, and writes real level.
   */
  const feedNow = async () => {
    const currentPortion = feederData.portionSize || 1;
    const spinText = `${(currentPortion * 1.5).toFixed(1)}s servo spin`;
    const now = Date.now();
    // Unique monotonically increasing 31-bit integer ID (requires zero pre-read!)
    const commandId = Math.floor(now / 100) % 2000000000;

    const dispenseInfo = {
      timestamp: now,
      servoSpin: spinText,
      portion: currentPortion,
    };

    // Mark that the user intentionally tapped Feed Now in this session
    lastTapTimeRef.current = now;

    // 1. Arm safety fallback FIRST so UI never stays stuck even if network lags
    if (safetyTimeoutRef.current) clearTimeout(safetyTimeoutRef.current);
    safetyTimeoutRef.current = setTimeout(async () => {
      lastTapTimeRef.current = 0;
      setFeederData((prev) => ({ ...prev, servoStatus: 'Ready' }));
      try {
        await set(ref(db, 'feeder/servoStatus'), 'Ready');
      } catch (e) {
        // ignore
      }
    }, currentPortion * 1600 + 3500);

    // 2. Send SINGLE atomic update packet to Firebase Realtime Database (instant!)
    await update(ref(db, 'feeder'), {
      servoStatus: 'Dispensing',
      feedCommand: commandId,
      portionSize: currentPortion,
      lastDispense: dispenseInfo,
    });

    // 3. Fire-and-forget dispense event log in Cloud Firestore (non-blocking)
    syncToFirestore('main', {
      servoStatus: 'Dispensing',
      lastDispense: dispenseInfo,
      updatedAt: now,
    }).catch(() => {});

    if (firestore) {
      addDoc(collection(firestore, 'feedLogs'), {
        timestamp: now,
        type: 'manual',
        portionSize: currentPortion,
        servoSpin: spinText,
        foodLevelAtDispense: feederData.foodLevel,
      }).catch(() => {});
    }
  };

  /** Trigger ESP8266 to take a genuine ultrasonic distance reading immediately */
  const refreshSensorReading = async () => {
    try {
      await set(ref(db, 'feeder/triggerSensorRead'), true);
    } catch (e) {
      console.warn('Trigger sensor read error:', e);
    }
  };

  /** Update portion size — saves to RTDB & Firestore */
  const setPortionSize = async (size) => {
    const validSize = Math.max(1, Math.min(5, size));
    await set(ref(db, 'feeder/portionSize'), validSize);
    await syncToFirestore('main', { portionSize: validSize });
  };

  /** Toggle vacation mode — saves to RTDB & Firestore */
  const setVacationMode = async (val) => {
    await set(ref(db, 'feeder/vacationMode'), val);
    await syncToFirestore('main', { vacationMode: val });
  };

  /** Add a new schedule — saves to RTDB & Firestore */
  const addSchedule = async (schedule) => {
    const schedData = { ...schedule, active: true, createdAt: Date.now() };
    const newRef = await push(ref(db, 'feeder/schedules'), schedData);

    try {
      if (newRef.key) {
        await setDoc(doc(firestore, 'schedules', newRef.key), {
          ...schedData,
          id: newRef.key,
        });
      }
    } catch (e) {
      console.warn('Firestore add schedule warning:', e.message);
    }
  };

  /** Toggle a schedule on/off — saves to RTDB & Firestore */
  const toggleSchedule = async (id, current) => {
    const nextState = !current;
    await set(ref(db, `feeder/schedules/${id}/active`), nextState);

    try {
      await updateDoc(doc(firestore, 'schedules', id), { active: nextState });
    } catch (e) {
      console.warn('Firestore toggle schedule warning:', e.message);
    }
  };

  /** Delete a schedule — removes from RTDB & Firestore */
  const deleteSchedule = async (id) => {
    await set(ref(db, `feeder/schedules/${id}`), null);

    try {
      await deleteDoc(doc(firestore, 'schedules', id));
    } catch (e) {
      console.warn('Firestore delete schedule warning:', e.message);
    }
  };

  return {
    feederData,
    schedules,
    foodHistory,
    loading,
    feedNow,
    refreshSensorReading,
    setPortionSize,
    setVacationMode,
    addSchedule,
    toggleSchedule,
    deleteSchedule,
  };
}