// screens/SchedulesScreen.js
// Feeding schedules — mirrors right screen in the design image

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS } from '../theme/colors';

// ── Schedule Card ─────────────────────────────────────────────────────────────

function isSchedulePassedToday(time, ampm) {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const cleanTime = (time || '00:00').trim();
  let [h, m] = cleanTime.split(':').map(Number);
  if (isNaN(h)) h = 0;
  if (isNaN(m)) m = 0;
  const ap = (ampm || '').trim().toUpperCase();
  if (ap === 'PM' && h < 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return h * 60 + m <= currentMinutes;
}

function ScheduleCard({ schedule, onToggle, onDelete }) {
  const { name, time, ampm, frequency, portionSize, spinDuration, active, icon } = schedule;
  const passedToday = active && isSchedulePassedToday(time, ampm);

  return (
    <View style={[cardStyles.card, !active && cardStyles.cardInactive]}>
      {/* Row 1: icon + name + toggle */}
      <View style={cardStyles.row}>
        <View style={[cardStyles.iconWrap, { backgroundColor: active ? '#EEF8F6' : '#F5F5F5' }]}>
          <Text style={{ fontSize: 20 }}>{icon || '🐟'}</Text>
        </View>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={cardStyles.name}>{name}</Text>
          <View style={cardStyles.statusRow}>
            <View
              style={[
                cardStyles.statusDot,
                { backgroundColor: active ? COLORS.online : COLORS.textLight },
              ]}
            />
            <Text style={[cardStyles.statusText, { color: active ? COLORS.online : COLORS.textLight }]}>
              {!active ? 'PAUSED' : passedToday ? 'ACTIVE · DONE TODAY' : 'ACTIVE · UPCOMING'}
            </Text>
          </View>
        </View>
        <Switch
          value={active}
          onValueChange={() => onToggle(schedule.id, active)}
          trackColor={{ false: '#E0E0E0', true: COLORS.tealLight }}
          thumbColor={active ? COLORS.teal : '#fff'}
        />
      </View>

      {/* Row 2: time + frequency */}
      <View style={cardStyles.timeRow}>
        <View>
          <Text style={cardStyles.timeLabel}>TIME</Text>
          <Text style={cardStyles.timeValue}>
            {time} {ampm}
          </Text>
        </View>
        <View style={cardStyles.freqBadge}>
          <Ionicons name="calendar-outline" size={12} color={COLORS.textLight} />
          <Text style={cardStyles.freqText}>{frequency}</Text>
        </View>
      </View>

      {/* Row 3: portion + spin badges */}
      <View style={cardStyles.badgeRow}>
        <View style={cardStyles.badge}>
          <MaterialCommunityIcons name="fish" size={11} color={COLORS.coral} />
          <Text style={[cardStyles.badgeText, { color: COLORS.coral }]}>{portionSize}x Portion</Text>
        </View>
        <View style={[cardStyles.badge, { backgroundColor: '#F0FAF9' }]}>
          <MaterialCommunityIcons name="rotate-3d-variant" size={11} color={COLORS.tealLight} />
          <Text style={[cardStyles.badgeText, { color: COLORS.tealLight }]}>{spinDuration}</Text>
        </View>
        <TouchableOpacity
          style={cardStyles.deleteBtn}
          onPress={() =>
            Alert.alert('Delete Schedule', `Remove "${name}"?`, [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => onDelete(schedule.id) },
            ])
          }
        >
          <Ionicons name="trash-outline" size={14} color={COLORS.textLight} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  cardInactive: { opacity: 0.7 },
  row: { flexDirection: 'row', alignItems: 'center' },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { fontSize: 15, fontWeight: '700', color: COLORS.textDark },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  timeLabel: { fontSize: 10, color: COLORS.textLight, letterSpacing: 0.5 },
  timeValue: { fontSize: 28, fontWeight: '800', color: COLORS.textDark, marginTop: 2 },
  freqBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F2F5F4',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  freqText: { fontSize: 12, color: COLORS.textMid, fontWeight: '600' },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFF0EC',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  badgeText: { fontSize: 11, fontWeight: '600' },
  deleteBtn: { marginLeft: 'auto', padding: 4 },
});

// ── Add Schedule Modal ───────────────────────────────────────────────────────

function AddScheduleModal({ visible, onClose, onAdd }) {
  const [name, setName] = useState('');
  const [time, setTime] = useState('08:00');
  const [ampm, setAmpm] = useState('AM');
  const [frequency, setFrequency] = useState('Daily');
  const [portionSize, setPortionSize] = useState(1);
  const [spinDuration, setSpinDuration] = useState('1.5s spin');
  const [icon, setIcon] = useState('🌅');

  const ICONS = ['🌅', '🌙', '🐟', '🦐', '⏰', '🌊'];
  const FREQS = ['Daily', 'Mon-Fri', 'Weekends', 'Custom'];

  const handleAdd = () => {
    if (!name.trim()) return Alert.alert('Name required');
    onAdd({ name: name.trim(), time, ampm, frequency, portionSize, spinDuration, icon });
    setName('');
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={modalStyles.overlay}
      >
        <View style={modalStyles.sheet}>
          <Text style={modalStyles.title}>New Schedule</Text>

          <Text style={modalStyles.label}>Name</Text>
          <TextInput
            style={modalStyles.input}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Morning Drop"
            placeholderTextColor={COLORS.textLight}
          />

          <Text style={modalStyles.label}>Icon</Text>
          <View style={modalStyles.iconRow}>
            {ICONS.map((ic) => (
              <TouchableOpacity
                key={ic}
                style={[modalStyles.iconBtn, icon === ic && modalStyles.iconBtnActive]}
                onPress={() => setIcon(ic)}
              >
                <Text style={{ fontSize: 22 }}>{ic}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={modalStyles.row}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text style={modalStyles.label}>Time (HH:MM)</Text>
              <TextInput
                style={modalStyles.input}
                value={time}
                onChangeText={setTime}
                placeholder="08:00"
                placeholderTextColor={COLORS.textLight}
                keyboardType="numbers-and-punctuation"
              />
            </View>
            <View style={{ flex: 0.5 }}>
              <Text style={modalStyles.label}>AM/PM</Text>
              <View style={modalStyles.toggleRow}>
                {['AM', 'PM'].map((v) => (
                  <TouchableOpacity
                    key={v}
                    style={[modalStyles.toggleBtn, ampm === v && modalStyles.toggleBtnActive]}
                    onPress={() => setAmpm(v)}
                  >
                    <Text
                      style={[modalStyles.toggleTxt, ampm === v && { color: COLORS.white }]}
                    >
                      {v}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>

          <Text style={modalStyles.label}>Frequency</Text>
          <View style={modalStyles.iconRow}>
            {FREQS.map((f) => (
              <TouchableOpacity
                key={f}
                style={[modalStyles.freqBtn, frequency === f && modalStyles.freqBtnActive]}
                onPress={() => setFrequency(f)}
              >
                <Text
                  style={[modalStyles.freqTxt, frequency === f && { color: COLORS.white }]}
                >
                  {f}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={modalStyles.label}>Portion Size: {portionSize}x</Text>
          <View style={modalStyles.row}>
            <TouchableOpacity
              style={modalStyles.counterBtn}
              onPress={() => setPortionSize(Math.max(1, portionSize - 1))}
            >
              <Ionicons name="remove" size={18} color={COLORS.teal} />
            </TouchableOpacity>
            <View style={modalStyles.counterDisplay}>
              <Text style={modalStyles.counterValue}>{portionSize}</Text>
            </View>
            <TouchableOpacity
              style={modalStyles.counterBtn}
              onPress={() => setPortionSize(Math.min(5, portionSize + 1))}
            >
              <Ionicons name="add" size={18} color={COLORS.teal} />
            </TouchableOpacity>
          </View>

          <View style={[modalStyles.row, { marginTop: 20, gap: 10 }]}>
            <TouchableOpacity style={modalStyles.cancelBtn} onPress={onClose}>
              <Text style={modalStyles.cancelTxt}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={modalStyles.addBtn} onPress={handleAdd}>
              <Text style={modalStyles.addTxt}>Add Schedule</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const modalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    paddingBottom: 36,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.textDark,
    marginBottom: 16,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textLight,
    marginBottom: 6,
    marginTop: 12,
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: '#F7F9F9',
    borderRadius: 12,
    padding: 12,
    fontSize: 15,
    color: COLORS.textDark,
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  iconRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#F5F5F5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnActive: { backgroundColor: COLORS.tealPale, borderWidth: 2, borderColor: COLORS.tealLight },
  toggleRow: { flexDirection: 'row', backgroundColor: '#F2F5F4', borderRadius: 10, padding: 2 },
  toggleBtn: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 8 },
  toggleBtnActive: { backgroundColor: COLORS.teal },
  toggleTxt: { fontSize: 13, fontWeight: '700', color: COLORS.textMid },
  freqBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: '#F2F5F4',
  },
  freqBtnActive: { backgroundColor: COLORS.teal },
  freqTxt: { fontSize: 12, fontWeight: '600', color: COLORS.textMid },
  counterBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#EEF5F4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  counterDisplay: {
    flex: 1,
    alignItems: 'center',
  },
  counterValue: { fontSize: 22, fontWeight: '800', color: COLORS.textDark },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: '#F2F5F4',
    alignItems: 'center',
  },
  cancelTxt: { fontWeight: '700', color: COLORS.textMid },
  addBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: COLORS.coral,
    alignItems: 'center',
  },
  addTxt: { fontWeight: '700', color: COLORS.white },
});

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function SchedulesScreen({
  schedules,
  feederData,
  onToggle,
  onDelete,
  onAdd,
  setVacationMode,
}) {
  const insets = useSafeAreaInsets();
  const [showModal, setShowModal] = useState(false);
  const totalPortions = schedules.reduce((sum, s) => sum + (s.active ? s.portionSize : 0), 0);

  const topPadding = Math.max(insets.top, Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 16) + 8;

  return (
    <View style={styles.container}>
      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: topPadding }]}>
        <View>
          <Text style={styles.title}>Feeding Schedules</Text>
          <Text style={styles.subtitle}>
            {schedules.length} routines · {totalPortions.toFixed(1)} portions/day
          </Text>
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={() => setShowModal(true)}>
          <Ionicons name="add" size={16} color={COLORS.white} />
          <Text style={styles.addBtnText}>Add New</Text>
        </TouchableOpacity>
      </View>

      {/* ── Automation banner ── */}
      <View style={styles.automationBanner}>
        <MaterialCommunityIcons name="auto-fix" size={16} color={COLORS.teal} />
        <Text style={styles.automationText}>Automation is configured</Text>
        <Text style={styles.automationRight}>LOCAL · IST (UTC+5:30)</Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 24) + 60 }}
      >
        <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
          {schedules.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={{ fontSize: 40 }}>🐠</Text>
              <Text style={styles.emptyText}>No schedules yet</Text>
              <Text style={styles.emptySubText}>Tap "+ Add New" to create one</Text>
            </View>
          ) : (
            schedules.map((s) => (
              <ScheduleCard
                key={s.id}
                schedule={s}
                onToggle={onToggle}
                onDelete={onDelete}
              />
            ))
          )}

          {/* ── Vacation Mode ── */}
          <View
            style={[
              styles.vacationCard,
              feederData.vacationMode && { backgroundColor: COLORS.coralLight },
            ]}
          >
            <View style={styles.vacationRow}>
              <View
                style={[
                  styles.vacationIcon,
                  { backgroundColor: feederData.vacationMode ? COLORS.coral : '#FFD8CC' },
                ]}
              >
                <Text style={{ fontSize: 22 }}>🏖️</Text>
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.vacationTitle}>Vacation Mode</Text>
                <Text style={[styles.vacationSub, feederData.vacationMode && { color: COLORS.coral }]}>
                  {feederData.vacationMode ? 'ALL ROUTINES PAUSED' : 'Schedules running'}
                </Text>
              </View>
              <Switch
                value={feederData.vacationMode}
                onValueChange={setVacationMode}
                trackColor={{ false: '#E0E0E0', true: '#F4A590' }}
                thumbColor={feederData.vacationMode ? COLORS.coral : '#fff'}
              />
            </View>
            {feederData.vacationMode && (
              <Text style={styles.vacationNote}>
                ⓘ  Schedules remain saved. Turn this off to resume automatic feeding.
              </Text>
            )}
          </View>

          <View style={{ height: 24 }} />
        </View>
      </ScrollView>

      <AddScheduleModal
        visible={showModal}
        onClose={() => setShowModal(false)}
        onAdd={onAdd}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
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
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.coral,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  addBtnText: {
    color: COLORS.white,
    fontWeight: '700',
    fontSize: 13,
  },
  automationBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.tealPale,
    marginHorizontal: 16,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
  },
  automationText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.teal,
    fontWeight: '500',
  },
  automationRight: {
    fontSize: 11,
    color: COLORS.tealLight,
    fontWeight: '600',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 8,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textDark,
  },
  emptySubText: {
    fontSize: 13,
    color: COLORS.textLight,
  },
  vacationCard: {
    backgroundColor: COLORS.card,
    borderRadius: 20,
    padding: 16,
    marginTop: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  vacationRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  vacationIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vacationTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textDark,
  },
  vacationSub: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.textLight,
    letterSpacing: 0.5,
    marginTop: 2,
  },
  vacationNote: {
    marginTop: 12,
    fontSize: 12,
    color: COLORS.coral,
    lineHeight: 18,
  },
});
