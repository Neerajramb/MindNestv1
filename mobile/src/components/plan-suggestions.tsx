import { Alert, View } from 'react-native';

import type { SuggestedReminder } from '@/api/assistant';
import { errorMessage } from '@/api/client';
import { useAddMyReminder } from '@/api/hooks';
import { addDays, formatClock, formatDay, isoDateIn } from '@/lib/time';
import { Button } from '@/ui/button';
import { Card } from '@/ui/card';
import { AppText } from '@/ui/text';
import { colors, space } from '@/ui/theme';

type Props = {
  patientId: string | undefined;
  timeZone: string | undefined;
  plans: SuggestedReminder[];
  /** Called when a plan was added or declined, so the parent can take it off the list. */
  onDone: (plan: SuggestedReminder) => void;
  onAdded: (plan: SuggestedReminder) => void;
};

/**
 * "I heard a plan": reminders suggested from a saved conversation. Nothing is scheduled until the patient taps
 * "Add reminder", so a misheard recording never creates a reminder on its own.
 */
export function PlanSuggestions({ patientId, timeZone, plans, onDone, onAdded }: Props) {
  const addReminder = useAddMyReminder(patientId);
  if (!plans.length) return null;

  const today = isoDateIn(timeZone);
  const dayLabel = (date: string) =>
    date === today ? 'Today' : date === addDays(today, 1) ? 'Tomorrow' : formatDay(`${date}T12:00:00Z`);
  const accept = (plan: SuggestedReminder) =>
    addReminder
      .mutateAsync(plan)
      .then(() => {
        onDone(plan);
        onAdded(plan);
      })
      .catch((e) => Alert.alert('Could not add the reminder', errorMessage(e)));

  return (
    <Card tint={colors.primarySoft}>
      <AppText variant="title">I heard a plan</AppText>
      <AppText>Would you like a reminder?</AppText>
      {plans.map((plan) => (
        <View key={`${plan.title}-${plan.date}-${plan.time}`} style={{ gap: space.sm }}>
          <AppText variant="bodyStrong">
            {plan.title} · {dayLabel(plan.date)} at {formatClock(plan.time)}
          </AppText>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button
              label="Add reminder"
              icon="add"
              onPress={() => void accept(plan)}
              loading={addReminder.isPending && addReminder.variables === plan}
              style={{ flex: 1 }}
            />
            <Button label="No thanks" tone="ghost" onPress={() => onDone(plan)} style={{ flex: 1 }} />
          </View>
        </View>
      ))}
    </Card>
  );
}
