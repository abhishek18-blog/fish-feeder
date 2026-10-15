// components/DonutChart.js
// Circular food-level gauge driven by real ultrasonic sensor data

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { COLORS } from '../theme/colors';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const SIZE = 180;
const STROKE_WIDTH = 16;
const RADIUS = (SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function DonutChart({ percentage = 100, burnPerDay = 6 }) {
  const animatedValue = useRef(new Animated.Value(0)).current;

  const validPct = Math.max(0, Math.min(100, Math.round(percentage)));

  useEffect(() => {
    Animated.timing(animatedValue, {
      toValue: validPct,
      duration: 800,
      useNativeDriver: false,
    }).start();
  }, [validPct]);

  const strokeDashoffset = animatedValue.interpolate({
    inputRange: [0, 100],
    outputRange: [CIRCUMFERENCE, 0],
  });

  // Dynamic days left calculation based on burn rate
  const burn = burnPerDay > 0 ? burnPerDay : 6;
  const daysLeft = validPct > 0 ? Math.round(validPct / burn) : 0;

  // Arc color: alert coral if food level is low (<= 15%), teal otherwise
  const isLow = validPct <= 15;
  const activeColor = isLow ? COLORS.coral : COLORS.tealLight;

  return (
    <View style={styles.container}>
      <Svg width={SIZE} height={SIZE}>
        <G rotation="-90" origin={`${SIZE / 2}, ${SIZE / 2}`}>
          {/* Background track */}
          <Circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            stroke="#E8F4F2"
            strokeWidth={STROKE_WIDTH}
            fill="none"
          />
          {/* Filled arc */}
          <AnimatedCircle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            stroke={activeColor}
            strokeWidth={STROKE_WIDTH}
            fill="none"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
          />
        </G>
      </Svg>

      {/* Center text */}
      <View style={styles.center}>
        <Text style={[styles.percentText, isLow && { color: COLORS.coral }]}>{validPct}%</Text>
        <Text style={[styles.fullLabel, isLow && { color: COLORS.coral }]}>
          {validPct === 0 ? 'EMPTY' : validPct < 20 ? 'LOW' : 'FULL'}
        </Text>
        <Text style={styles.daysLabel}>
          {validPct === 0
            ? 'Refill needed'
            : daysLeft <= 1
            ? '~1 Day Left'
            : `~${daysLeft} Days Left`}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    position: 'absolute',
    alignItems: 'center',
  },
  percentText: {
    fontSize: 34,
    fontWeight: '800',
    color: COLORS.textDark,
  },
  fullLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.tealLight,
    letterSpacing: 1.5,
    marginTop: -2,
  },
  daysLabel: {
    fontSize: 11,
    color: COLORS.textLight,
    marginTop: 2,
    fontWeight: '500',
  },
  distanceLabel: {
    fontSize: 9,
    color: COLORS.teal,
    marginTop: 2,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
});
