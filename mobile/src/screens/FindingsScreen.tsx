import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { FindingCard } from '../components/FindingCard';
import { colors } from '../theme';
import { Finding } from '../types';

type Filter = 'ALL' | 'CRITICAL' | 'WARNING';

export function FindingsScreen({ findings }: { findings: Finding[] }) {
  const [filter, setFilter] = useState<Filter>('ALL');
  const counts = {
    ALL: findings.length,
    CRITICAL: findings.filter((f) => f.severity === 'CRITICAL').length,
    WARNING: findings.filter((f) => f.severity === 'WARNING').length,
  };
  const visible = filter === 'ALL' ? findings : findings.filter((f) => f.severity === filter);

  return (
    <View style={styles.wrap}>
      <View style={styles.tabs}>
        {(['ALL', 'CRITICAL', 'WARNING'] as Filter[]).map((f) => {
          const active = filter === f;
          return (
            <Pressable
              key={f}
              onPress={() => setFilter(f)}
              style={[styles.tab, active && styles.tabActive]}
            >
              <Text style={[styles.tabText, active && styles.tabTextActive]}>
                {f} {counts[f]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {visible.length === 0 ? (
          <Text style={styles.empty}>✅ No findings in this category — clean sprint.</Text>
        ) : (
          visible.map((f, i) => <FindingCard key={`${f.ruleId}-${i}`} finding={f} />)
        )}
        <View style={{ height: 32 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
  },
  tabs: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 4,
  },
  tab: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabActive: {
    backgroundColor: colors.actionGreen,
    borderColor: colors.actionGreen,
  },
  tabText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  tabTextActive: {
    color: colors.bgDeep,
  },
  content: {
    padding: 16,
  },
  empty: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 40,
  },
});
