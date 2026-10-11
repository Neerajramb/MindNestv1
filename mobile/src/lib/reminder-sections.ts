import type { Reminder } from '@/api/types';
import { displayState, type DisplayState } from '@/components/reminder-card';
import { addDays, formatDay, isoDateIn } from '@/lib/time';

export type ReminderSection = { title: string; items: Reminder[] };

const byTime = (a: Reminder, b: Reminder) => a.due_at.localeCompare(b.due_at);

/**
 * Due and missed first, then what is coming up split by day (each card only shows a time, so a reminder for
 * tomorrow must sit under a "Tomorrow" heading), then what is done.
 */
export function reminderSections(reminders: Reminder[], timeZone: string | undefined, now: Date): ReminderSection[] {
  const by = (states: DisplayState[]) => reminders.filter((r) => states.includes(displayState(r, now))).sort(byTime);
  const today = isoDateIn(timeZone, now);
  const dayTitle = (day: string) =>
    day === today ? 'Later today' : day === addDays(today, 1) ? 'Tomorrow' : formatDay(`${day}T12:00:00Z`);
  const days = new Map<string, Reminder[]>();
  for (const r of by(['upcoming', 'snoozed'])) {
    const day = isoDateIn(timeZone, new Date(r.due_at));
    days.set(day, [...(days.get(day) ?? []), r]);
  }
  return [
    { title: 'Due now', items: by(['due']) },
    { title: 'Missed — tap if you already did it', items: by(['missed']) },
    ...[...days.entries()].map(([day, items]) => ({ title: dayTitle(day), items })),
    { title: 'Done', items: by(['done']) },
  ].filter((section) => section.items.length > 0);
}
