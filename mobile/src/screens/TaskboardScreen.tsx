import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { StoryCard } from '../components/StoryCard';
import { colors, laneColor } from '../theme';
import { Sprint } from '../types';
import { groupByStory } from '../engine';

const LANE_ORDER = ['To do', 'In Progress', 'In Review', 'Completed', 'Blocked'];

export function TaskboardScreen({ sprint }: { sprint: Sprint }) {
  const groups = groupByStory(sprint.tasks);

  const laneCounts: Record<string, number> = {};
  sprint.tasks.forEach((t) => (laneCounts[t.lane] = (laneCounts[t.lane] ?? 0) + 1));
  const lanes = LANE_ORDER.filter((l) => laneCounts[l]);

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.laneRow}>
        {lanes.map((lane) => {
          const lc = laneColor(lane);
          return (
            <View key={lane} style={[styles.laneChip, { backgroundColor: lc.bg }]}>
              <Text style={[styles.laneCount, { color: lc.fg }]}>{laneCounts[lane]}</Text>
              <Text style={[styles.laneLabel, { color: lc.fg }]}>{lane}</Text>
            </View>
          );
        })}
      </View>

      {groups.map((g) => (
        <StoryCard key={g.storyId ?? g.storyTitle} group={g} />
      ))}
      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 16,
  },
  laneRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  laneChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: 'center',
    minWidth: 70,
  },
  laneCount: {
    fontSize: 18,
    fontWeight: '800',
  },
  laneLabel: {
    fontSize: 10,
    fontWeight: '700',
    marginTop: 1,
  },
});
