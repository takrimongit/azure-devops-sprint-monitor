import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { GradeBadge } from '../components/GradeBadge';
import { SummaryCards } from '../components/SummaryCards';
import { TeamBreakdown } from '../components/TeamBreakdown';
import { colors } from '../theme';
import { HygieneResult, Sprint } from '../types';

function sprintShort(name: string): string {
  return name.split('\\').pop() ?? name;
}

function metric(label: string, value: string) {
  return (
    <View style={styles.metricRow}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

export function DashboardScreen({ sprint, result }: { sprint: Sprint; result: HygieneResult }) {
  const m = result.metrics;
  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.sprintName}>{sprintShort(sprint.name)}</Text>
      <Text style={styles.dates}>
        {sprint.startDate} → {sprint.endDate} · {result.teamMembers} team members
      </Text>

      <GradeBadge
        grade={result.grade}
        label={result.gradeLabel}
        criticals={result.criticalIssues}
        warnings={result.warnings}
      />

      <View style={styles.spacer} />
      <SummaryCards metrics={m} />

      <Text style={styles.sectionTitle}>Sprint Metrics</Text>
      <View style={styles.metricsCard}>
        {metric('Completion rate', `${m.completionPct.toFixed(1)}%`)}
        {metric('New / unstarted ratio', `${m.newTaskPct.toFixed(1)}%`)}
        {metric('Avg days in New', m.avgDaysInNew.toFixed(1))}
        {metric('Avg days in Active', m.avgDaysInActive.toFixed(1))}
        {metric('Removed', String(m.removedTasks))}
      </View>

      <Text style={styles.sectionTitle}>Team Load</Text>
      <TeamBreakdown breakdown={m.personBreakdown} />

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 16,
  },
  sprintName: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '800',
  },
  dates: {
    color: colors.textMuted,
    fontSize: 13,
    marginBottom: 16,
    marginTop: 2,
  },
  spacer: {
    height: 14,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    marginTop: 24,
    marginBottom: 10,
  },
  metricsCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.cardAlt,
  },
  metricLabel: {
    color: colors.textMuted,
    fontSize: 14,
  },
  metricValue: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
});
