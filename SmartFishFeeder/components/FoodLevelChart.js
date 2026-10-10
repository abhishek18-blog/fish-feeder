// components/FoodLevelChart.js
// Area/line chart showing food level trend over time dynamically

import React from 'react';
import { View, Text, StyleSheet, Dimensions, TouchableOpacity } from 'react-native';
import Svg, { Path, Defs, LinearGradient, Stop, Line, Circle } from 'react-native-svg';
import { COLORS } from '../theme/colors';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CHART_WIDTH = SCREEN_WIDTH - 64;
const CHART_HEIGHT = 100;

const RANGES = ['24H', '7D', '30D'];

function generatePath(data, w, h) {
  if (!data || data.length < 2) return '';
  const maxV = 100;
  const minV = 0;
  const xStep = w / (data.length - 1);

  const points = data.map((d, i) => {
    const x = i * xStep;
    const clamped = Math.max(minV, Math.min(maxV, d));
    const y = h - ((clamped - minV) / (maxV - minV)) * h;
    return [x, y];
  });

  // Smooth area fill path
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length; i++) {
    const [x, y] = points[i];
    const [px, py] = points[i - 1];
    const cx = (px + x) / 2;
    d += ` C ${cx} ${py} ${cx} ${y} ${x} ${y}`;
  }
  // Close area
  d += ` L ${points[points.length - 1][0]} ${h} L ${points[0][0]} ${h} Z`;
  return { area: d, points };
}

export default function FoodLevelChart({
  history = [],
  currentLevel = 100,
  burnPerDay = 6,
  activeRange = '7D',
  onRangeChange,
}) {
  // Build display data from real history if available
  let displayData;
  if (history && history.length >= 2) {
    displayData = history.map((h) => (typeof h.level === 'number' ? h.level : 100));
  } else if (history && history.length === 1) {
    displayData = [history[0].level, currentLevel];
  } else {
    // Sensible initial trend ending at currentLevel
    const cur = typeof currentLevel === 'number' ? currentLevel : 100;
    displayData = [Math.min(100, cur + 20), Math.min(100, cur + 14), Math.min(100, cur + 8), cur];
  }

  const result = generatePath(displayData, CHART_WIDTH, CHART_HEIGHT);
  const lastPoint = result.points ? result.points[result.points.length - 1] : null;
  const todayPct = Math.max(0, Math.min(100, Math.round(displayData[displayData.length - 1])));

  // Dynamic drop calculation
  const totalDrop = displayData[0] - todayPct;
  const trendSubtitle =
    totalDrop > 0
      ? `~${Math.round(totalDrop)}% drop recorded`
      : 'Sensor reading stable';

  // Dynamic projected empty date
  const burn = burnPerDay > 0 ? burnPerDay : 6;
  const daysUntilEmpty = Math.max(0, Math.round(todayPct / burn));
  const emptyDate = new Date(Date.now() + daysUntilEmpty * 86400000);
  const emptyDateText =
    todayPct === 0
      ? 'Refill needed'
      : `${emptyDate.toLocaleDateString([], { month: 'short', day: 'numeric' })} - empty`;

  return (
    <View style={styles.container}>
      {/* Header row */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Food Level Trend</Text>
          <Text style={styles.subtitle}>{trendSubtitle}</Text>
        </View>
        <View style={styles.rangeRow}>
          {RANGES.map((r) => (
            <TouchableOpacity
              key={r}
              style={[styles.rangeBtn, activeRange === r && styles.rangeBtnActive]}
              onPress={() => onRangeChange && onRangeChange(r)}
            >
              <Text style={[styles.rangeTxt, activeRange === r && styles.rangeTxtActive]}>{r}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Y axis label */}
      <Text style={styles.yLabel}>100%</Text>

      {/* SVG chart */}
      <Svg width={CHART_WIDTH} height={CHART_HEIGHT + 20} style={{ marginTop: 4 }}>
        <Defs>
          <LinearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={COLORS.tealLight} stopOpacity="0.5" />
            <Stop offset="100%" stopColor={COLORS.tealLight} stopOpacity="0.02" />
          </LinearGradient>
        </Defs>

        {/* Area fill */}
        {result.area && <Path d={result.area} fill="url(#grad)" />}

        {/* Dashed red projection line (last point → empty) */}
        {lastPoint && (
          <Line
            x1={lastPoint[0]}
            y1={lastPoint[1]}
            x2={CHART_WIDTH}
            y2={CHART_HEIGHT}
            stroke={COLORS.coral}
            strokeWidth={1.5}
            strokeDasharray="4,3"
          />
        )}

        {/* Current level dot */}
        {lastPoint && (
          <>
            <Circle cx={lastPoint[0]} cy={lastPoint[1]} r={5} fill={COLORS.tealLight} />
            <Circle cx={lastPoint[0]} cy={lastPoint[1]} r={3} fill={COLORS.white} />
          </>
        )}

        {/* End "empty" dot */}
        <Circle cx={CHART_WIDTH - 2} cy={CHART_HEIGHT - 2} r={4} fill={COLORS.coral} />
      </Svg>

      {/* X axis label */}
      <View style={styles.xRow}>
        <Text style={styles.xLabel}>{todayPct}%</Text>
        <Text style={[styles.xLabel, { color: COLORS.coral }]}>{emptyDateText}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.card,
    borderRadius: 20,
    padding: 16,
    marginHorizontal: 16,
    marginTop: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textDark,
  },
  subtitle: {
    fontSize: 11,
    color: COLORS.textLight,
    marginTop: 2,
  },
  rangeRow: {
    flexDirection: 'row',
    backgroundColor: '#F2F5F4',
    borderRadius: 10,
    padding: 2,
  },
  rangeBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  rangeBtnActive: {
    backgroundColor: COLORS.teal,
  },
  rangeTxt: {
    fontSize: 11,
    color: COLORS.textLight,
    fontWeight: '600',
  },
  rangeTxtActive: {
    color: COLORS.white,
  },
  yLabel: {
    fontSize: 10,
    color: COLORS.textLight,
    marginTop: 8,
  },
  xRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  xLabel: {
    fontSize: 10,
    color: COLORS.textLight,
  },
});
