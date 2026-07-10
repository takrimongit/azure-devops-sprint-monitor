import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, gradeColor } from '../theme';

export function GradeBadge({
  grade,
  label,
  criticals,
  warnings,
}: {
  grade: string;
  label: string;
  criticals: number;
  warnings: number;
}) {
  const c = gradeColor(grade);
  return (
    <View style={styles.wrap}>
      <View style={[styles.dial, { borderColor: c }]}>
        <Text style={[styles.grade, { color: c }]}>{grade}</Text>
      </View>
      <View style={styles.meta}>
        <Text style={styles.label}>{label}</Text>
        <View style={styles.row}>
          <View style={[styles.dot, { backgroundColor: colors.critical }]} />
          <Text style={styles.metaText}>
            {criticals} critical{criticals !== 1 ? 's' : ''}
          </Text>
          <View style={[styles.dot, { backgroundColor: colors.warning, marginLeft: 14 }]} />
          <Text style={styles.metaText}>
            {warnings} warning{warnings !== 1 ? 's' : ''}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dial: {
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grade: {
    fontSize: 40,
    fontWeight: '800',
  },
  meta: {
    marginLeft: 18,
    flex: 1,
  },
  label: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  metaText: {
    color: colors.textMuted,
    fontSize: 13,
  },
});
