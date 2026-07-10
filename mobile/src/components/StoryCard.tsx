import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, laneColor } from '../theme';
import { StoryGroup } from '../types';
import { Pill } from './Pill';

export function StoryCard({ group }: { group: StoryGroup }) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={2}>
          📋 {group.storyTitle}
        </Text>
        {group.storyId != null && <Text style={styles.storyId}>#{group.storyId}</Text>}
      </View>
      {group.tasks.map((t) => {
        const lc = laneColor(t.lane);
        return (
          <View key={t.id} style={styles.taskRow}>
            <Pill label={t.lane} bg={lc.bg} fg={lc.fg} />
            <View style={styles.taskBody}>
              <Text style={styles.taskTitle} numberOfLines={2}>
                <Text style={styles.taskId}>#{t.id} </Text>
                {t.title}
              </Text>
              <Text style={styles.assignee}>{t.assignedTo}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  title: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },
  storyId: {
    color: colors.textFaint,
    fontSize: 11,
    marginLeft: 6,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.cardAlt,
    gap: 10,
  },
  taskBody: {
    flex: 1,
  },
  taskTitle: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
  },
  taskId: {
    color: colors.textFaint,
    fontSize: 12,
  },
  assignee: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 3,
  },
});
