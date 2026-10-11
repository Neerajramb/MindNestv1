import { describe, expect, test } from '@jest/globals';

import type { ActivityEntry, AlertItem, Reminder, SafetySummary } from '@/api/types';
import { displayState } from '@/components/reminder-card';
import { describeSafety } from '@/components/safety-status';
import { newAlerts } from '@/features/caregiver-alerts';
import { nextReminder } from '@/features/next-reminder';
import { upcomingToSchedule } from '@/features/reminder-notifications';
import { describeActivity } from '@/lib/activity';
import { describeRule } from '@/lib/recurrence';
import { reminderSections } from '@/lib/reminder-sections';
import { addDays, formatClock, isValidClock, isoDateIn } from '@/lib/time';

const NOW = new Date('2026-10-10T04:00:00Z'); // 09:30 IST

function reminder(overrides: Partial<Reminder>): Reminder {
  return {
    id: 'r', type: 'MEDICATION', source_id: 's', scheduled_at: NOW.toISOString(), due_at: NOW.toISOString(),
    message: 'Take Metformin', detail: '', status: 'PENDING', snoozed_until: null, acknowledged_at: null,
    acknowledged_late: false, ...overrides,
  };
}

describe('time helpers', () => {
  test('clock formatting and validation', () => {
    expect(formatClock('09:30')).toBe('9:30 am');
    expect(formatClock('21:05')).toBe('9:05 pm');
    expect(formatClock('00:00')).toBe('12:00 am');
    expect(isValidClock('23:59')).toBe(true);
    expect(isValidClock('24:00')).toBe(false);
  });

  test('dates use the patient timezone', () => {
    expect(isoDateIn('Asia/Kolkata', new Date('2026-10-09T20:00:00Z'))).toBe('2026-10-10');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
  });
});

describe('reminder logic', () => {
  test('display state follows status and due time', () => {
    expect(displayState(reminder({}), NOW)).toBe('due');
    expect(displayState(reminder({ due_at: '2026-10-10T05:00:00Z' }), NOW)).toBe('upcoming');
    expect(displayState(reminder({ status: 'SNOOZED', due_at: '2026-10-10T04:10:00Z' }), NOW)).toBe('snoozed');
    expect(displayState(reminder({ status: 'ACKNOWLEDGED' }), NOW)).toBe('done');
    expect(displayState(reminder({ status: 'MISSED' }), NOW)).toBe('missed');
  });

  test('next reminder prefers the earliest open one and ignores stale ones', () => {
    const list = [
      reminder({ id: 'old', due_at: '2026-10-10T01:00:00Z' }),
      reminder({ id: 'later', due_at: '2026-10-10T06:00:00Z' }),
      reminder({ id: 'soon', due_at: '2026-10-10T03:50:00Z' }),
      reminder({ id: 'done', status: 'ACKNOWLEDGED', due_at: '2026-10-10T03:55:00Z' }),
    ];
    expect(nextReminder(list, NOW)?.id).toBe('soon');
  });

  test('only future open reminders are scheduled as notifications', () => {
    const list = [
      reminder({ id: 'past', due_at: '2026-10-10T03:00:00Z' }),
      reminder({ id: 'b', due_at: '2026-10-10T07:00:00Z' }),
      reminder({ id: 'a', due_at: '2026-10-10T05:00:00Z' }),
      reminder({ id: 'done', status: 'ACKNOWLEDGED', due_at: '2026-10-10T06:00:00Z' }),
    ];
    expect(upcomingToSchedule(list, NOW).map((r) => r.id)).toEqual(['a', 'b']);
  });
});

describe('safety wording', () => {
  const base: SafetySummary = {
    status: 'INSIDE', zone_name: 'Home', location_sharing_enabled: true, has_safe_zones: true, location_stale: false,
    last_location: { latitude: 8.5, longitude: 76.9, accuracy_m: 10, recorded_at: new Date().toISOString(), source: 'GPS', is_mocked: false },
  };

  test('never reports safe without a fresh location', () => {
    expect(describeSafety(base, 'caregiver').title).toBe('In safe zone: Home');
    expect(describeSafety({ ...base, location_stale: true }, 'caregiver').title).toBe('Location not available');
    expect(describeSafety({ ...base, last_location: null }, 'patient').title).toBe('Location not available');
    expect(describeSafety({ ...base, status: 'OUTSIDE' }, 'caregiver').title).toBe('Outside all safe zones');
    expect(describeSafety({ ...base, location_sharing_enabled: false }, 'caregiver').title).toBe('Location sharing is off');
  });
});

describe('caregiver alert announcements', () => {
  const alert = (id: string) => ({ id }) as AlertItem;
  test('first load announces nothing, later loads announce only new ids', () => {
    expect(newAlerts([alert('a')], null)).toEqual([]);
    expect(newAlerts([alert('a'), alert('b')], new Set(['a'])).map((a) => a.id)).toEqual(['b']);
  });
});

test('repeat rules are described in plain words', () => {
  expect(describeRule('FREQ=DAILY')).toBe('Every day');
  expect(describeRule('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR')).toBe('Weekdays');
  expect(describeRule('FREQ=WEEKLY;BYDAY=MO')).toBe('Some days each week');
});

describe('reminderSections', () => {
  test('upcoming reminders are grouped by day, so a plan for tomorrow sits under "Tomorrow"', () => {
    const list = [
      reminder({ id: 'tue', message: 'Lunch', due_at: '2026-10-12T07:30:00Z', scheduled_at: '2026-10-12T07:30:00Z' }),
      reminder({ id: 'mon', message: 'Have lunch', due_at: '2026-10-11T09:30:00Z', scheduled_at: '2026-10-11T09:30:00Z' }),
      reminder({ id: 'sat', message: 'Walk', due_at: '2026-10-10T05:30:00Z', scheduled_at: '2026-10-10T05:30:00Z' }),
      reminder({ id: 'done', status: 'ACKNOWLEDGED', due_at: '2026-10-10T03:00:00Z', scheduled_at: '2026-10-10T03:00:00Z' }),
    ];
    const sections = reminderSections(list, 'Asia/Kolkata', NOW);
    expect(sections.map((s) => s.title)).toEqual(['Later today', 'Tomorrow', 'Monday, 12 October', 'Done']);
    expect(sections[1].items.map((r) => r.message)).toEqual(['Have lunch']);
  });
});

describe('describeActivity', () => {
  const entry = (event_type: string, event_data: Record<string, unknown>): ActivityEntry => ({
    id: 'a', category: 'ACTIVITY', event_type, event_data, actor_name: 'Thomas', actor_role: 'PATIENT', created_at: NOW.toISOString(),
  });

  test('says who was seen, what was recorded and which reminder was added', () => {
    expect(describeActivity(entry('face.recognition', { result: 'RECOGNIZED', person: 'Neeraj', via: 'live' }))).toEqual({
      title: 'Saw Neeraj', detail: 'Seen in Live', icon: 'person',
    });
    expect(describeActivity(entry('memory.saved', { source: 'VOICE', person: 'Neeraj' })).title).toBe('Recorded a conversation with Neeraj');
    expect(describeActivity(entry('memory.saved', { source: 'TEXT', person: null })).title).toBe('Wrote a note to remember');
    expect(
      describeActivity(
        entry('reminder.added', { title: 'Have lunch with Neeraj', summary: 'Have lunch with Neeraj at 3:00 pm on Mon 12 Oct', from_conversation: true }),
      ),
    ).toEqual({ title: 'Added a reminder: Have lunch with Neeraj', detail: '3:00 pm on Mon 12 Oct · From a saved conversation', icon: 'reminders' });
  });

  test('reminders, questions and alerts read as sentences, and older entries still make sense', () => {
    expect(describeActivity(entry('reminder.acknowledged', { message: 'Take Metformin', late: true }))).toMatchObject({
      title: 'Done: Take Metformin', detail: 'Confirmed late',
    });
    expect(describeActivity(entry('reminder.acknowledged', { reminder_type: 'MEDICATION' })).title).toBe('Confirmed a reminder (medication)');
    expect(describeActivity(entry('assistant.query', { intent: 'MEDICATION', spoken: true })).title).toBe('Asked MindNest about their medicines');
    expect(describeActivity(entry('alert.created', { alert_type: 'SOS' })).title).toBe('Asked for help');
    expect(describeActivity(entry('face.recognition', { result: 'RECOGNIZED', person: 'Neeraj', live: true })).detail).toBe('Seen in Live');
    expect(describeActivity(entry('something.new', {})).title).toBe('something new');
  });
});
