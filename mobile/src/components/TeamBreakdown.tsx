import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

export function TeamBreakdown({ breakdown }: { breakdown: Record<string, number> }) {
  const entries = Object.entries(breakdown).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, c]) => c));
  return (
    <View style={styles.card}>
      {entries.map(([person, count]) => (
        <View key={person} style={styles.row}>
          <Text style={styles.name} numberOfLines={1}>
            {person}
          </Text>
          <View style={styles.barTrack}>
            <View
              style={[
                styles.barFill,
                {
                  width: `${(count / max) * 100}%`,
                  backgroundColor: person === 'Unassigned' ? colors.critical : colors.actionGreen,
                },
              ]}
            />
          </View>
          <Text style={styles.count}>{count}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 5,
  },
  name: {
    color: colors.text,
    fontSize: 13,
    width: 96,
  },
  barTrack: {
    flex: 1,
    height: 10,
    backgroundColor: colors.cardAlt,
    borderRadius: 5,
    marginHorizontal: 10,
    overflow: 'hidden',
  },
  barFill: {
    height: 10,
    borderRadius: 5,
  },
  count: {
    color: colors.textMuted,
    fontSize: 13,
    width: 22,
    textAlign: 'right',
  },
});
