// screens/CalibrationScreen.js
// Device calibration — real ESP8266 servo test via feedCommand & genuine ultrasonic sensor ping

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  Platform,
  StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import { ref, set, update } from 'firebase/database';
import { db } from '../firebase/config';
import { COLORS } from '../theme/colors';

function CalibCard({ title, subtitle, children, iconName, iconColor }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={[styles.cardIcon, { backgroundColor: `${iconColor}20` }]}>
          <MaterialCommunityIcons name={iconName} size={22} color={iconColor} />
        </View>
        <View style={{ marginLeft: 12, flex: 1 }}>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={styles.cardSub}>{subtitle}</Text>
        </View>
      </View>
      <View style={{ marginTop: 14 }}>{children}</View>
    </View>
  );
}

export default function CalibrationScreen({ feederData, refreshSensorReading }) {
  const insets = useSafeAreaInsets();
  const [portionTest, setPortionTest] = useState(1); // 1x = 1 full 360° spin (1.5s)
  const [testing, setTesting] = useState(false);
  const [pingingSensor, setPingingSensor] = useState(false);

  /**
   * Real servo test: writes a new feedCommand ID to Firebase so the ESP8266's
   * actual loop() picks it up and runs dispenseFood() — same path as "Feed Now".
   */
  const runServoTest = async () => {
    if (!feederData.deviceOnline) {
      Alert.alert('Device Offline', 'ESP8266 is not connected. Make sure the feeder is powered on and Wi-Fi is connected.');
      return;
    }
    setTesting(true);
    try {
      const commandId = Math.floor(Date.now() / 100) % 2000000000;
      await update(ref(db, 'feeder'), {
        feedCommand: commandId,
        portionSize: portionTest,
        servoStatus: 'Dispensing',
      });

      // Wait for hardware to finish (portionTest * 1500ms + buffer)
      const spinMs = portionTest * 1500 + 2000;
      setTimeout(() => {
        setTesting(false);
        Alert.alert(
          '✅ Servo Test Sent',
          `Command sent to ESP8266. If device is online, it will spin ${portionTest}x (${(portionTest * 1.5).toFixed(1)}s).`
        );
      }, spinMs);
    } catch (e) {
      setTesting(false);
      Alert.alert('Error', e.message);
    }
  };

  /**
   * Real sensor ping: writes triggerSensorRead = true to Firebase.
   * ESP8266 detects this in its 15s loop and immediately calls measureAndSyncUltrasonic().
   * The updated distance & food level flow back through the real-time listener in useFeederData.
   */
  const handlePingSensor = async () => {
    if (!feederData.deviceOnline) {
      Alert.alert('Device Offline', 'ESP8266 must be online to ping the sensor.');
      return;
    }
    setPingingSensor(true);
    try {
      await set(ref(db, 'feeder/triggerSensorRead'), true);
      // Give ESP8266 up to 3 seconds to respond
      setTimeout(() => {
        setPingingSensor(false);
        Alert.alert(
          '📡 Ping Sent',
          `ESP8266 has been asked to take a genuine HC-SR04 reading.\n\nLive reading will update below within a few seconds.`
        );
      }, 3000);
    } catch (e) {
      setPingingSensor(false);
      Alert.alert('Error', e.message);
    }
  };

  const topPadding = Math.max(insets.top, Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 16) + 8;
  const bottomPadding = Math.max(insets.bottom, 24) + 60;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingTop: topPadding, paddingBottom: bottomPadding }}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Calibration</Text>
        <Text style={styles.subtitle}>Configure servo & ultrasonic sensor settings</Text>
      </View>

      {/* Device info */}
      <View style={styles.infoRow}>
        <View style={styles.infoItem}>
          <Text style={styles.infoLabel}>Device</Text>
          <Text style={styles.infoValue}>ESP8266 Feeder</Text>
        </View>
        <View style={styles.infoItem}>
          <Text style={styles.infoLabel}>Sensor</Text>
          <Text style={styles.infoValue}>HC-SR04</Text>
        </View>
        <View style={styles.infoItem}>
          <Text style={styles.infoLabel}>Status</Text>
          <Text style={[styles.infoValue, { color: feederData.deviceOnline ? COLORS.online : COLORS.coral }]}>
            {feederData.deviceOnline ? 'Online' : 'Offline'}
          </Text>
        </View>
      </View>

      {/* Ultrasonic Sensor Status & Calibration */}
      <CalibCard
        title="Ultrasonic Sensor (HC-SR04)"
        subtitle="Distance range: 1.0 cm (Full) to 5.0 cm (Empty)"
        iconName="radar"
        iconColor={COLORS.teal}
      >
        <View style={styles.sensorGrid}>
          <View style={styles.sensorBox}>
            <Text style={styles.sensorBoxLabel}>MAX DISTANCE (0%)</Text>
            <Text style={styles.sensorBoxVal}>5.0 cm</Text>
          </View>
          <View style={styles.sensorBox}>
            <Text style={styles.sensorBoxLabel}>MIN DISTANCE (100%)</Text>
            <Text style={styles.sensorBoxVal}>1.0 cm</Text>
          </View>
        </View>

        <View style={styles.readingRow}>
          <Text style={styles.fieldLabel}>Current Distance:</Text>
          <Text style={styles.readingVal}>
            {feederData.foodDistanceCm != null
              ? `${feederData.foodDistanceCm.toFixed(1)} cm`
              : 'Waiting for ESP8266 ping...'}
          </Text>
        </View>

        <View style={styles.readingRow}>
          <Text style={styles.fieldLabel}>Calculated Food Level:</Text>
          <Text style={[styles.readingVal, { color: COLORS.teal, fontWeight: '800' }]}>
            {feederData.foodLevel}%
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.actionBtn, pingingSensor && { opacity: 0.7 }]}
          onPress={handlePingSensor}
          disabled={pingingSensor}
          activeOpacity={0.8}
        >
          {pingingSensor ? (
            <ActivityIndicator color={COLORS.white} size="small" />
          ) : (
            <>
              <Feather name="refresh-cw" size={16} color={COLORS.white} />
              <Text style={styles.actionBtnText}>Ping Ultrasonic Sensor Now</Text>
            </>
          )}
        </TouchableOpacity>
      </CalibCard>

      {/* Servo test — Real feedCommand to ESP8266 */}
      <CalibCard
        title="Servo Motor Test"
        subtitle="Triggers a real dispense via ESP8266 feedCommand"
        iconName="rotate-3d-variant"
        iconColor={COLORS.tealLight}
      >
        <Text style={styles.fieldLabel}>Test Portions: {portionTest}x ({(portionTest * 1.5).toFixed(1)}s spin)</Text>
        <View style={styles.spinRow}>
          <TouchableOpacity
            style={styles.spinBtn}
            onPress={() => setPortionTest((v) => Math.max(1, v - 1))}
          >
            <Ionicons name="remove" size={18} color={COLORS.teal} />
          </TouchableOpacity>
          <View style={styles.spinDisplay}>
            <Text style={styles.spinValue}>{portionTest}x</Text>
          </View>
          <TouchableOpacity
            style={styles.spinBtn}
            onPress={() => setPortionTest((v) => Math.min(5, v + 1))}
          >
            <Ionicons name="add" size={18} color={COLORS.teal} />
          </TouchableOpacity>
        </View>
        <Text style={styles.hintText}>
          Sends a real feedCommand to Firebase → ESP8266 detects it and spins the servo.
          Device must be online.
        </Text>
        <TouchableOpacity
          style={[styles.actionBtn, testing && { opacity: 0.7 }]}
          onPress={runServoTest}
          disabled={testing}
          activeOpacity={0.8}
        >
          {testing ? (
            <ActivityIndicator color={COLORS.white} size="small" />
          ) : (
            <>
              <MaterialCommunityIcons name="rotate-3d-variant" size={16} color={COLORS.white} />
              <Text style={styles.actionBtnText}>Run Servo Test on Hardware</Text>
            </>
          )}
        </TouchableOpacity>
      </CalibCard>

      {/* Danger zone */}
      <View style={[styles.card, styles.dangerCard]}>
        <Text style={[styles.cardTitle, { color: COLORS.coral }]}>⚠️  Danger Zone</Text>
        <TouchableOpacity
          style={styles.dangerBtn}
          onPress={() =>
            Alert.alert('Factory Reset', 'This will reset schedules and calibration to defaults.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Reset',
                style: 'destructive',
                onPress: async () => {
                  await set(ref(db, 'feeder/foodLevel'), 100);
                  await set(ref(db, 'feeder/portionSize'), 1);
                  await set(ref(db, 'feeder/servoStatus'), 'Ready');
                  Alert.alert('✅ Done', 'Feeder reset to defaults.');
                },
              },
            ])
          }
        >
          <Text style={styles.dangerBtnText}>Factory Reset Feeder</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    paddingHorizontal: 16,
  },
  header: {
    paddingVertical: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.textDark,
  },
  subtitle: {
    fontSize: 13,
    color: COLORS.textLight,
    marginTop: 2,
  },
  hintText: {
    fontSize: 11.5,
    color: COLORS.textLight,
    lineHeight: 16,
    marginTop: 6,
    marginBottom: 4,
    fontStyle: 'italic',
  },
  infoRow: {
    flexDirection: 'row',
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  infoItem: {
    flex: 1,
    alignItems: 'center',
  },
  infoLabel: {
    fontSize: 10,
    color: COLORS.textLight,
    marginBottom: 2,
  },
  infoValue: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textDark,
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 20,
    padding: 16,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textDark,
  },
  cardSub: {
    fontSize: 11,
    color: COLORS.textLight,
    marginTop: 2,
  },
  sensorGrid: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  sensorBox: {
    flex: 1,
    backgroundColor: '#F3F7F6',
    borderRadius: 12,
    padding: 10,
    alignItems: 'center',
  },
  sensorBoxLabel: {
    fontSize: 9,
    color: COLORS.textLight,
    fontWeight: '700',
    marginBottom: 2,
  },
  sensorBoxVal: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.textDark,
  },
  readingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
    marginBottom: 6,
  },
  readingVal: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textDark,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textDark,
  },
  spinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 10,
    gap: 12,
  },
  spinBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#EEF8F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinDisplay: {
    flex: 1,
    height: 36,
    backgroundColor: '#F9FBFB',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E0EFEF',
  },
  spinValue: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textDark,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.teal,
    borderRadius: 14,
    paddingVertical: 12,
    gap: 8,
    marginTop: 10,
  },
  actionBtnText: {
    color: COLORS.white,
    fontWeight: '700',
    fontSize: 14,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 10,
    gap: 8,
  },
  levelInput: {
    flex: 1,
    height: 44,
    backgroundColor: '#F9FBFB',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#EAEAEA',
    paddingHorizontal: 14,
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textDark,
  },
  pctSuffix: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textLight,
  },
  dangerCard: {
    borderWidth: 1,
    borderColor: '#FFD5CC',
    backgroundColor: '#FFF7F5',
  },
  dangerBtn: {
    marginTop: 10,
    paddingVertical: 12,
    backgroundColor: COLORS.coral,
    borderRadius: 12,
    alignItems: 'center',
  },
  dangerBtnText: {
    color: COLORS.white,
    fontWeight: '700',
    fontSize: 13,
  },
});
