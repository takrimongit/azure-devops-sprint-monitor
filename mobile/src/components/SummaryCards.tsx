import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';
import { SprintMetrics } from '../types';

function Card({ value, label, color }: { value: number | string; label: string; color: string }) {
  return (
    <View style={styles.card}>
      <Text style={[styles.value, { color }]}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

export function SummaryCards({ metrics }: { metrics: SprintMetrics }) {
  return (
    <View style={styles.row}>
      <Card value={metrics.totalTasks} label="TOTAL" color={colors.text} />
      <Card value={metrics.activeTasks} label="ACTIVE" color={colors.brandBlue} />
      <Card value={metrics.newTasks} label="NEW" color={colors.warning} />
      <Card value={metrics.closedTasks} label="CLOSED" color={colors.good} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  card: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  value: {
    fontSize: 24,
    fontWeight: '800',
  },
  label: {
    color: colors.textFaint,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginTop: 4,
  },
});
