import { StatusBar } from 'expo-status-bar';
import React, { useMemo, useState } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { FindingsScreen } from './src/screens/FindingsScreen';
import { TaskboardScreen } from './src/screens/TaskboardScreen';
import { evaluateSprint } from './src/engine';
import { orgName, projectName, sampleSprint } from './src/sampleData';
import { colors } from './src/theme';

type Tab = 'dashboard' | 'findings' | 'taskboard';

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'dashboard', label: 'Health', icon: '◈' },
  { key: 'findings', label: 'Findings', icon: '⚠' },
  { key: 'taskboard', label: 'Board', icon: '▦' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('dashboard');

  // Run the ported hygiene engine on load — same logic as the backend.
  const result = useMemo(() => evaluateSprint(sampleSprint), []);

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />

      {/* Brand header */}
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <View style={styles.logoMark}>
            <Text style={styles.logoChevron}>≫</Text>
          </View>
          <View>
            <Text style={styles.brandName}>Helpables · Sprint Health</Text>
            <Text style={styles.brandSub}>
              {orgName} / {projectName}
            </Text>
          </View>
        </View>
      </View>

      {/* Active screen */}
      <View style={styles.body}>
        {tab === 'dashboard' && <DashboardScreen sprint={sampleSprint} result={result} />}
        {tab === 'findings' && <FindingsScreen findings={result.findings} />}
        {tab === 'taskboard' && <TaskboardScreen sprint={sampleSprint} />}
      </View>

      {/* Bottom tab bar */}
      <View style={styles.tabBar}>
        {TABS.map((t) => {
          const active = tab === t.key;
          const badge = t.key === 'findings' ? result.findings.length : undefined;
          return (
            <Pressable key={t.key} style={styles.tabBtn} onPress={() => setTab(t.key)}>
              <Text style={[styles.tabIcon, active && styles.tabIconActive]}>{t.icon}</Text>
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{t.label}</Text>
              {badge ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{badge}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bgDeep,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bgNavy,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  logoMark: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.bgDeep,
    borderWidth: 2,
    borderColor: colors.brandGreen,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoChevron: {
    color: colors.brandGreen,
    fontSize: 20,
    fontWeight: '800',
    marginTop: -2,
  },
  brandName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  brandSub: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 1,
  },
  body: {
    flex: 1,
  },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bgNavy,
    paddingBottom: 6,
  },
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
  },
  tabIcon: {
    color: colors.textFaint,
    fontSize: 20,
  },
  tabIconActive: {
    color: colors.brandGreen,
  },
  tabLabel: {
    color: colors.textFaint,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  tabLabelActive: {
    color: colors.text,
  },
  badge: {
    position: 'absolute',
    top: 4,
    right: '28%',
    backgroundColor: colors.critical,
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
  },
});
