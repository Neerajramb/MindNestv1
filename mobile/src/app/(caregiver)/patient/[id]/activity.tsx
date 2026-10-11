import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';

import { errorMessage } from '@/api/client';
import { useActivity, usePatient } from '@/api/hooks';
import type { ActivityEntry } from '@/api/types';
import { describeActivity } from '@/lib/activity';
import { addDays, formatDay, formatTime, isoDateIn } from '@/lib/time';
import { Card } from '@/ui/card';
import { NamedIcon } from '@/ui/icon';
import { Screen } from '@/ui/screen';
import { EmptyState, ErrorState, LoadingState } from '@/ui/states';
import { AppText } from '@/ui/text';
import { colors, space } from '@/ui/theme';

/** Activity log (CARE-06, FR-024): what the patient did, newest first, under one heading per day. */
export default function Activity() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const tz = usePatient(id).data?.timezone;
  const activity = useActivity(id);

  const days = useMemo(() => {
    const today = isoDateIn(tz);
    const title = (day: string) =>
      day === today ? 'Today' : day === addDays(today, -1) ? 'Yesterday' : formatDay(`${day}T12:00:00Z`);
    const groups = new Map<string, ActivityEntry[]>();
    for (const entry of activity.data ?? []) {
      const day = isoDateIn(tz, new Date(entry.created_at));
      groups.set(day, [...(groups.get(day) ?? []), entry]);
    }
    return [...groups.entries()].map(([day, entries]) => ({ title: title(day), entries }));
  }, [activity.data, tz]);

  return (
    <Screen refreshing={activity.isRefetching} onRefresh={() => void activity.refetch()}>
      {activity.isLoading ? <LoadingState /> : null}
      {activity.error && !activity.data ? <ErrorState message={errorMessage(activity.error)} onRetry={() => void activity.refetch()} /> : null}
      {activity.data?.length === 0 ? <EmptyState icon="activity" title="No activity yet" /> : null}
      {days.map(({ title, entries }) => (
        <View key={title} style={{ gap: space.sm }}>
          <AppText variant="title" accessibilityRole="header">
            {title}
          </AppText>
          {entries.map((entry) => {
            const what = describeActivity(entry);
            return (
              <Card key={entry.id}>
                <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}>
                  <NamedIcon name={what.icon} size={26} color={colors.primary} />
                  <View style={{ flex: 1, gap: space.xs }}>
                    <AppText variant="bodyStrong">{what.title}</AppText>
                    {what.detail ? <AppText color={colors.textMuted}>{what.detail}</AppText> : null}
                    <AppText variant="caption" color={colors.textMuted}>
                      {formatTime(entry.created_at, tz)}
                      {entry.actor_name ? ` · ${entry.actor_name}` : ''}
                    </AppText>
                  </View>
                </View>
              </Card>
            );
          })}
        </View>
      ))}
    </Screen>
  );
}
