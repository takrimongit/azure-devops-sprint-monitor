import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';
import { Finding } from '../types';

export function FindingCard({ finding }: { finding: Finding }) {
  const isCritical = finding.severity === 'CRITICAL';
  const accent = isCritical ? colors.critical : colors.warning;
  return (
    <View style={[styles.card, { borderLeftColor: accent }]}>
      <View style={styles.header}>
        <Text style={[styles.severity, { color: accent }]}>{finding.severity}</Text>
        <Text style={styles.ruleId}>{finding.ruleId}</Text>
      </View>
      <Text style={styles.message}>{finding.message}</Text>
      <Text style={styles.details}>{finding.details}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderLeftWidth: 4,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  severity: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  ruleId: {
    color: colors.textFaint,
    fontSize: 10,
    fontWeight: '600',
    marginLeft: 8,
  },
  message: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  details: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
});
