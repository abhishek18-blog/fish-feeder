// screens/LogsScreen.js
// Feeding activity log — shows history of dispenses

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Platform,
  StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { COLORS } from '../theme/colors';

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return `Today · ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function LogItem({ item, index }) {
  const isManual = item.type === 'manual';
  return (
    <View style={styles.item}>
      <View style={[styles.iconWrap, { backgroundColor: isManual ? '#FFF0EC' : '#EEF8F6' }]}>
        {isManual ? (
          <MaterialCommunityIcons name="gesture-tap" size={20} color={COLORS.coral} />
        ) : (
          <Ionicons name="time-outline" size={20} color={COLORS.tealLight} />
        )}
      </View>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={styles.itemTitle}>
          {isManual ? 'Manual Feed' : item.scheduleName ?? 'Scheduled Feed'}
        </Text>
        <Text style={styles.itemSub}>{formatDate(item.timestamp)}</Text>
      </View>
      <View style={styles.rightCol}>
        <View style={[styles.badge, { backgroundColor: isManual ? '#FFF0EC' : '#EEF8F6' }]}>
          <Text style={[styles.badgeText, { color: isManual ? COLORS.coral : COLORS.tealLight }]}>
            {item.servoSpin ?? '1.5s spin'}
          </Text>
        </View>
        <Text style={styles.levelText}>{item.level != null ? `${item.level}%` : ''}</Text>
      </View>
    </View>
  );
}

export default function LogsScreen({ foodHistory, schedules }) {
  const insets = useSafeAreaInsets();
  const topPadding = Math.max(insets.top, Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 16) + 8;
  const bottomPadding = Math.max(insets.bottom, 24) + 60;

  // Build a combined feed log from foodHistory
  const logs = (foodHistory || [])
    .slice()
    .reverse()
    .map((h, i) => ({
      id: h.id || String(i),
      timestamp: h.timestamp,
      level: h.level,
      type: h.type || 'scheduled',
      servoSpin: h.servoSpin,
      scheduleName: h.scheduleName,
    }));

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: topPadding }]}>
        <Text style={styles.title}>Feed Logs</Text>
        <Text style={styles.subtitle}>{logs.length} events recorded</Text>
      </View>

      {logs.length === 0 ? (
        <View style={styles.empty}>
          <Text style={{ fontSize: 48 }}>📋</Text>
          <Text style={styles.emptyTitle}>No logs yet</Text>
          <Text style={styles.emptySub}>Feed events will appear here</Text>
        </View>
      ) : (
        <FlatList
          data={logs}
          keyExtractor={(item) => item.id}
          renderItem={({ item, index }) => <LogItem item={item} index={index} />}
          contentContainerStyle={{ padding: 16, paddingBottom: bottomPadding }}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.textDark,
  },
  subtitle: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 3,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textDark,
  },
  itemSub: {
    fontSize: 11,
    color: COLORS.textLight,
    marginTop: 2,
  },
  rightCol: {
    alignItems: 'flex-end',
    gap: 4,
  },
  badge: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  levelText: {
    fontSize: 11,
    color: COLORS.textLight,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textDark,
  },
  emptySub: {
    fontSize: 13,
    color: COLORS.textLight,
  },
});
