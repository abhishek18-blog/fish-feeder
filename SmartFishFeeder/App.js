// App.js — root of the SmartFish Feeder app
// Safe-area aware bottom tab navigator lifted above Android system navigation bar

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
  Platform,
} from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS } from './theme/colors';
import useFeederData from './hooks/useFeederData';
import HomeScreen from './screens/HomeScreen';
import SchedulesScreen from './screens/SchedulesScreen';
import LogsScreen from './screens/LogsScreen';
import CalibrationScreen from './screens/CalibrationScreen';

// ── Tab bar definition ───────────────────────────────────────────────────────

const TABS = [
  {
    key: 'home',
    label: 'Home',
    icon: (active) => (
      <Ionicons name="home" size={22} color={active ? COLORS.coral : COLORS.navInactive} />
    ),
  },
  {
    key: 'schedules',
    label: 'Schedules',
    icon: (active) => (
      <Ionicons
        name="calendar-outline"
        size={22}
        color={active ? COLORS.coral : COLORS.navInactive}
      />
    ),
  },
  {
    key: 'logs',
    label: 'Logs',
    icon: (active) => (
      <MaterialCommunityIcons
        name="format-list-bulleted"
        size={22}
        color={active ? COLORS.coral : COLORS.navInactive}
      />
    ),
  },
  {
    key: 'calibration',
    label: 'Calibration',
    icon: (active) => (
      <Ionicons
        name="options-outline"
        size={22}
        color={active ? COLORS.coral : COLORS.navInactive}
      />
    ),
  },
];

// ── Bottom Tab Bar (Lifted above Android navigation buttons) ──────────────────

function BottomTabBar({ activeTab, onTabPress }) {
  const insets = useSafeAreaInsets();
  // Ensure enough bottom clearance on Android devices with software navigation buttons
  const bottomPadding = Math.max(insets.bottom, Platform.OS === 'android' ? 24 : 14);

  return (
    <View style={[tabStyles.bar, { paddingBottom: bottomPadding }]}>
      {TABS.map((tab) => {
        const active = activeTab === tab.key;
        return (
          <TouchableOpacity
            key={tab.key}
            style={[tabStyles.tab, active && tabStyles.tabActive]}
            onPress={() => onTabPress(tab.key)}
            activeOpacity={0.7}
          >
            {tab.icon(active)}
            <Text style={[tabStyles.label, active && tabStyles.labelActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const tabStyles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: COLORS.navBg,
    borderTopWidth: 1,
    borderTopColor: '#EBEBEB',
    paddingTop: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 12,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 4,
    borderRadius: 12,
    gap: 3,
  },
  tabActive: {},
  label: {
    fontSize: 10,
    color: COLORS.navInactive,
    fontWeight: '500',
  },
  labelActive: {
    color: COLORS.coral,
    fontWeight: '700',
  },
});

// ── Main Content Container ────────────────────────────────────────────────────

function MainApp() {
  const [activeTab, setActiveTab] = useState('home');

  const {
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
  } = useFeederData();

  const renderScreen = () => {
    switch (activeTab) {
      case 'home':
        return (
          <HomeScreen
            feederData={feederData}
            foodHistory={foodHistory}
            feedNow={feedNow}
            setPortionSize={setPortionSize}
            refreshSensorReading={refreshSensorReading}
          />
        );
      case 'schedules':
        return (
          <SchedulesScreen
            schedules={schedules}
            feederData={feederData}
            onToggle={toggleSchedule}
            onDelete={deleteSchedule}
            onAdd={addSchedule}
            setVacationMode={setVacationMode}
          />
        );
      case 'logs':
        return <LogsScreen foodHistory={foodHistory} schedules={schedules} />;
      case 'calibration':
        return (
          <CalibrationScreen
            feederData={feederData}
            refreshSensorReading={refreshSensorReading}
          />
        );
      default:
        return null;
    }
  };

  return (
    <View style={rootStyles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />

      {loading ? (
        <View style={rootStyles.loadingContainer}>
          <Text style={{ fontSize: 48, marginBottom: 16 }}>🐡</Text>
          <ActivityIndicator size="large" color={COLORS.teal} />
          <Text style={rootStyles.loadingText}>Connecting to feeder…</Text>
        </View>
      ) : (
        <>
          <View style={{ flex: 1 }}>{renderScreen()}</View>
          <BottomTabBar activeTab={activeTab} onTabPress={setActiveTab} />
        </>
      )}
    </View>
  );
}

// ── Root with SafeAreaProvider ────────────────────────────────────────────────

export default function App() {
  return (
    <SafeAreaProvider>
      <MainApp />
    </SafeAreaProvider>
  );
}

const rootStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: COLORS.textLight,
    fontWeight: '500',
  },
});
