/**
 * seed-firebase.js
 * Run this script ONCE to populate your Firebase Realtime Database
 * AND Cloud Firestore with demo data.
 *
 * Usage:
 *   node seed-firebase.js
 */

// Load .env into process.env
require('dotenv').config();

const { initializeApp } = require('firebase/app');
const { getDatabase, ref, set, push } = require('firebase/database');
const { getFirestore, doc, setDoc, collection, addDoc } = require('firebase/firestore');

const firebaseConfig = {
  apiKey:            process.env.FIREBASE_API_KEY,
  authDomain:        process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL:       process.env.FIREBASE_DATABASE_URL,
  projectId:         process.env.FIREBASE_PROJECT_ID,
  storageBucket:     process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId:             process.env.FIREBASE_APP_ID,
};

// Validate that all required vars are present
const missing = Object.entries(firebaseConfig)
  .filter(([, v]) => !v)
  .map(([k]) => k);

if (missing.length > 0) {
  console.error('❌  Missing env vars in .env:', missing.join(', '));
  console.error('    Copy .env.example → .env and fill in your credentials.');
  process.exit(1);
}

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const firestore = getFirestore(app);

async function seed() {
  console.log('🐟  Seeding Firebase Realtime Database & Cloud Firestore…');

  const feederStatus = {
    foodLevel: 75,
    foodDistanceCm: 2.0,
    maxDistanceCm: 5.0,
    minDistanceCm: 1.0,
    portionSize: 1,
    servoStatus: 'Ready',
    nextFeed: '08:00 AM',
    burnPerDay: 6,
    deviceOnline: true,
    vacationMode: false,
    lastDispense: {
      timestamp: Date.now() - 4 * 60 * 1000,
      servoSpin: '1.5s servo spin',
      portion: 1,
    },
    updatedAt: Date.now(),
  };

  // 1. Seed Realtime Database
  console.log('-> Writing to RTDB...');
  await set(ref(db, 'feeder'), feederStatus);

  const sched1 = {
    name: 'Morning Drop',
    time: '08:00',
    ampm: 'AM',
    frequency: 'Daily',
    portionSize: 1.5,
    spinDuration: '2.2s spin',
    active: true,
    icon: '🌅',
  };

  const sched2 = {
    name: 'Evening Treat',
    time: '06:00',
    ampm: 'PM',
    frequency: 'Mon-Fri',
    portionSize: 1,
    spinDuration: '1.5s spin',
    active: true,
    icon: '🌙',
  };

  await push(ref(db, 'feeder/schedules'), sched1);
  await push(ref(db, 'feeder/schedules'), sched2);

  const histRef = ref(db, 'feeder/foodHistory');
  const levels = [100, 98, 95, 91, 86, 80, 74];
  const now = Date.now();
  for (let i = 0; i < levels.length; i++) {
    await push(histRef, {
      level: levels[i],
      timestamp: now - (6 - i) * 24 * 60 * 60 * 1000,
      type: i % 2 === 0 ? 'scheduled' : 'manual',
      servoSpin: '1.5s servo spin',
      scheduleName: 'Morning Drop',
    });
  }

  // 2. Seed Cloud Firestore
  console.log('-> Writing to Cloud Firestore...');
  try {
    await setDoc(doc(firestore, 'feeder', 'main'), feederStatus);
    await setDoc(doc(firestore, 'schedules', 'morning_drop'), { ...sched1, id: 'morning_drop' });
    await setDoc(doc(firestore, 'schedules', 'evening_treat'), { ...sched2, id: 'evening_treat' });

    for (let i = 0; i < levels.length; i++) {
      await addDoc(collection(firestore, 'feedHistory'), {
        level: levels[i],
        timestamp: now - (6 - i) * 24 * 60 * 60 * 1000,
        type: i % 2 === 0 ? 'scheduled' : 'manual',
        servoSpin: '1.5s servo spin',
        scheduleName: 'Morning Drop',
      });
    }
    console.log('✅ Firestore documents written successfully!');
  } catch (fsErr) {
    console.warn('⚠️ Cloud Firestore note:', fsErr.message);
    console.warn('   (Ensure Cloud Firestore is created in test mode in Firebase Console if not done yet)');
  }

  console.log('✅ Done! Open the app and it will show live data.');
  process.exit(0);
}

seed().catch((e) => {
  console.error('❌  Seed failed:', e.message);
  process.exit(1);
});
