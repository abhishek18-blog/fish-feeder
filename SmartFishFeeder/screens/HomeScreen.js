// screens/HomeScreen.js
// Main dashboard with thumb-friendly bottom Feed button and zero-confirmation instant dispensing

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  StatusBar,
  RefreshControl,
} from 'react-native';

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good Morning 🌅';
  if (hour < 17) return 'Good Afternoon ☀️';
  return 'Good Evening 🌙';
}
import { Ionicons, MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../theme/colors';
import DonutChart from '../components/DonutChart';
import FoodLevelChart from '../components/FoodLevelChart';

function StatCard({ icon, label, value }) {
  return (
    <View style={statStyles.card}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        {icon}
        <Text style={statStyles.label}>{label}</Text>
      </View>
      <Text style={statStyles.value} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const statStyles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 12,
    marginHorizontal: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  label: { fontSize: 10, color: COLORS.textLight, marginBottom: 4 },
  value: { fontSize: 13, fontWeight: '700', color: COLORS.textDark },
});

export default function HomeScreen({
  feederData,
  foodHistory,
  feedNow,
  setPortionSize,
  refreshSensorReading,
  user,
  onSignOut,
}) {
  const insets = useSafeAreaInsets();
  const [chartRange, setChartRange] = useState('7D');
  const [feeding, setFeeding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Clear spinner as soon as hardware reports Ready
  useEffect(() => {
    if (feederData.servoStatus === 'Ready') {
      setFeeding(false);
    }
  }, [feederData.servoStatus]);

  // Pull to refresh: requests a fresh ultrasonic ping from ESP8266
  const onRefresh = async () => {
    setRefreshing(true);
    if (refreshSensorReading) {
      await refreshSensorReading();
    }
    setTimeout(() => setRefreshing(false), 1500);
  };

  // Instant feed without confirmation popup — directly takes existing portion
  const handleFeedNow = async () => {
    if (feeding) return;
    setFeeding(true);
    const maxSpinMs = (feederData.portionSize || 1) * 1600 + 3000;
    const localTimer = setTimeout(() => setFeeding(false), maxSpinMs);
    try {
      await feedNow();
    } catch (e) {
      console.warn('Feed error:', e);
      clearTimeout(localTimer);
      setFeeding(false);
    }
  };

  const isDispensing = feeding;

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={{
        paddingTop: Math.max(insets.top, Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 16) + 8,
        paddingBottom: Math.max(insets.bottom, 24) + 60,
      }}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          colors={[COLORS.teal]}
          tintColor={COLORS.teal}
        />
      }
    >
      {/* ── Header ─────────────────────────────────────────── */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.greeting}>{getGreeting()}</Text>
          <Text style={styles.title}>
            {user?.displayName ? user.displayName.split(' ')[0] + "'s Aquarium" : 'My Aquarium Feeder'}
          </Text>
          <View style={styles.onlineRow}>
            <View
              style={[
                styles.onlineDot,
                { backgroundColor: feederData.deviceOnline ? COLORS.online : COLORS.coral },
              ]}
            />
            <Text
              style={[
                styles.onlineText,
                { color: feederData.deviceOnline ? COLORS.online : COLORS.coral },
              ]}
            >
              {feederData.deviceOnline ? 'Feeder Online' : 'Feeder Offline'}
            </Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity
            style={styles.settingsBtn}
            onPress={onRefresh}
            activeOpacity={0.7}
          >
            <Feather name="refresh-cw" size={18} color={COLORS.teal} />
          </TouchableOpacity>
          {onSignOut && (
            <TouchableOpacity
              style={[styles.settingsBtn, { backgroundColor: '#FFF0EC' }]}
              onPress={onSignOut}
              activeOpacity={0.7}
            >
              <Ionicons name="log-out-outline" size={18} color={COLORS.coral} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── 1. Donut gauge (Driven by Ultrasonic Sensor) ───── */}
      <View style={styles.gaugeContainer}>
        <DonutChart
          percentage={feederData.foodLevel}
          burnPerDay={feederData.burnPerDay}
        />

        {/* Sensor Connection Badge */}
        <View style={styles.sensorPill}>
          <MaterialCommunityIcons
            name="radar"
            size={14}
            color={feederData.sensorConnected !== false ? COLORS.teal : COLORS.coral}
          />
          <Text
            style={[
              styles.sensorPillText,
              feederData.sensorConnected === false && { color: COLORS.coral },
            ]}
          >
            {feederData.sensorConnected !== false
              ? 'Ultrasonic Sensor Active'
              : '⚠️ Sensor Disconnected (Check Wiring)'}
          </Text>
        </View>
      </View>

      {/* ── 2. Food Level Chart ────────────────────────────── */}
      <FoodLevelChart
        history={foodHistory}
        currentLevel={feederData.foodLevel}
        burnPerDay={feederData.burnPerDay}
        activeRange={chartRange}
        onRangeChange={setChartRange}
      />

      {/* ── 3. Quick Stats ─────────────────────────────────── */}
      <View style={styles.statsRow}>
        <StatCard
          icon={<Ionicons name="flame" size={12} color={COLORS.coral} />}
          label="Burn Rate"
          value={`~${feederData.burnPerDay}%/day`}
        />
        <StatCard
          icon={<MaterialCommunityIcons name="radar" size={13} color={COLORS.tealLight} />}
          label="Food Level"
          value={`${feederData.foodLevel ?? '--'}%`}
        />
        <StatCard
          icon={<Ionicons name="time-outline" size={12} color={COLORS.tealLight} />}
          label="Next Feed"
          value={feederData.nextFeed || '--:--'}
        />
      </View>

      {/* ── 4. Primary Feed Controls (Positioned DOWN for one-handed reach) ── */}
      <View style={styles.feedSection}>
        <View style={styles.feedRow}>
          <TouchableOpacity
            style={[
              styles.feedBtn,
              isDispensing && styles.feedBtnActive,
            ]}
            onPress={handleFeedNow}
            disabled={isDispensing}
            activeOpacity={0.8}
          >
            {isDispensing ? (
              <>
                <ActivityIndicator color={COLORS.white} size="small" />
                <Text style={styles.feedBtnText}>
                  Dispensing {feederData.portionSize}x…
                </Text>
              </>
            ) : (
              <>
                <MaterialCommunityIcons name="fish" size={20} color={COLORS.white} />
                <Text style={styles.feedBtnText}>Feed Now ({feederData.portionSize}x)</Text>
              </>
            )}
          </TouchableOpacity>

          <View style={styles.portionControl}>
            <TouchableOpacity
              style={styles.portionBtn}
              onPress={() => setPortionSize(feederData.portionSize - 1)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="remove" size={16} color={COLORS.teal} />
            </TouchableOpacity>
            <View style={styles.portionInfo}>
              <Text style={styles.portionValue}>Portion: {feederData.portionSize}x</Text>
              <Text style={styles.portionSub}>360° SERVO</Text>
            </View>
            <TouchableOpacity
              style={[styles.portionBtn, styles.portionBtnPlus]}
              onPress={() => setPortionSize(feederData.portionSize + 1)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="add" size={16} color={COLORS.white} />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.textDark,
  },
  greeting: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.teal,
    marginBottom: 2,
  },
  onlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 5,
  },
  onlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  onlineText: {
    fontSize: 12,
    fontWeight: '600',
  },
  settingsBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: COLORS.card,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },

  // Donut
  gaugeContainer: {
    alignItems: 'center',
    marginVertical: 12,
  },
  sensorPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.tealPale,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    marginTop: -8,
    marginBottom: 4,
    gap: 6,
  },
  sensorPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.teal,
    letterSpacing: 0.2,
  },

  // Feed section
  feedSection: {
    marginTop: 14,
  },
  feedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 10,
  },
  feedBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.coral,
    borderRadius: 16,
    paddingVertical: 15,
    gap: 8,
    shadowColor: COLORS.coral,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  feedBtnActive: {
    backgroundColor: '#D94E30',
  },
  feedBtnText: {
    color: COLORS.white,
    fontWeight: '700',
    fontSize: 15,
  },
  portionControl: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  portionBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#EEF5F4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  portionBtnPlus: {
    backgroundColor: COLORS.tealLight,
  },
  portionInfo: {
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  portionValue: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textDark,
  },
  portionSub: {
    fontSize: 9,
    color: COLORS.textLight,
    letterSpacing: 0.5,
  },

  // Stats
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginTop: 12,
  },

  // Last dispense
  lastDispense: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.card,
    borderRadius: 20,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  lastDispenseLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  lastDispenseIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#EEF8F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lastDispenseTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textDark,
  },
  lastDispenseSub: {
    fontSize: 11,
    color: COLORS.textLight,
    marginTop: 2,
  },
  spinBadge: {
    backgroundColor: COLORS.tealPale,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  spinBadgeText: {
    fontSize: 11,
    color: COLORS.teal,
    fontWeight: '600',
  },
});
