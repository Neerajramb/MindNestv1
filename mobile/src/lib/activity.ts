import type { ActivityEntry } from '@/api/types';
import type { IconName } from '@/ui/icon';

/** One activity entry in plain words: what happened, an optional second line, and an icon. */
export type ActivityText = { title: string; detail?: string; icon: IconName };

const TYPE_WORDS: Record<string, string> = {
  MEDICATION: 'medication',
  ROUTINE: 'routine',
  APPOINTMENT: 'appointment',
};

/** What the patient asked MindNest about. The question itself is never logged, only its kind. */
const QUESTION_TOPICS: Record<string, string> = {
  SCHEDULE: 'their day',
  MEDICATION: 'their medicines',
  APPOINTMENT: 'their appointments',
  REMINDER: 'their reminders',
  MEMORY: 'a past conversation',
  PERSON: 'who someone is',
  HELP: 'getting help',
  MEDICAL_ADVICE: 'medicine advice (MindNest pointed them to you or their doctor)',
  GENERAL: 'something general',
};

const ALERTS: Record<string, ActivityText> = {
  SOS: { title: 'Asked for help', detail: 'Pressed the Help button', icon: 'help' },
  GEOFENCE: { title: 'Alert: left a safe zone', icon: 'safety' },
  MEDICATION: { title: 'Alert: missed medication', icon: 'medication' },
  LOCATION_UNAVAILABLE: { title: 'Alert: location not available', icon: 'safety' },
  PATIENT_REMINDER: { title: 'Caregivers were told about a new reminder', icon: 'alert' },
};

const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);
const join = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(' · ') || undefined;

export function describeActivity(entry: ActivityEntry): ActivityText {
  const d = entry.event_data;
  const person = text(d.person);
  const message = text(d.message);
  const kind = text(d.reminder_type);
  const kindWord = kind ? TYPE_WORDS[kind] : undefined;

  switch (entry.event_type) {
    case 'face.recognition': {
      const via = d.via === 'live' || d.live === true ? 'Seen in Live' : 'Checked with “Who is this?”';
      if (d.result === 'RECOGNIZED' && person) return { title: `Saw ${person}`, detail: via, icon: 'person' };
      if (d.result === 'UNKNOWN') return { title: 'Saw someone they don’t know', detail: via, icon: 'person' };
      return { title: 'Used “Who is this?”', detail: 'No face was clear enough', icon: 'person' };
    }
    case 'memory.saved':
      return d.source === 'TEXT'
        ? { title: person ? `Wrote a note about ${person}` : 'Wrote a note to remember', icon: 'edit' }
        : { title: person ? `Recorded a conversation with ${person}` : 'Recorded a conversation', icon: 'mic' };
    case 'memory.deleted':
      return { title: person ? `Deleted a saved conversation with ${person}` : 'Deleted a saved conversation', icon: 'trash' };
    case 'reminder.added': {
      const title = text(d.title) ?? 'a reminder';
      const summary = text(d.summary);
      const when = summary?.startsWith(`${title} at `) ? summary.slice(title.length + 4) : summary;
      return {
        title: `Added a reminder: ${title}`,
        detail: join(when, d.from_conversation === true ? 'From a saved conversation' : undefined),
        icon: 'reminders',
      };
    }
    case 'reminder.acknowledged':
      return {
        title: message ? `Done: ${message}` : `Confirmed a reminder${kindWord ? ` (${kindWord})` : ''}`,
        detail: d.late === true ? 'Confirmed late' : undefined,
        icon: 'check',
      };
    case 'reminder.snoozed':
      return {
        title: message ? `Asked to be reminded later: ${message}` : 'Asked to be reminded later',
        detail: typeof d.minutes === 'number' ? `In ${d.minutes} minutes` : undefined,
        icon: 'clock',
      };
    case 'reminder.missed':
      return { title: message ? `Missed: ${message}` : `Missed a reminder${kindWord ? ` (${kindWord})` : ''}`, icon: 'missed' };
    case 'assistant.query': {
      const topic = QUESTION_TOPICS[text(d.intent) ?? ''] ?? 'something';
      return {
        title: `Asked MindNest about ${topic}`,
        detail: join(d.spoken === true ? 'Spoken' : undefined, person ? `While with ${person}` : undefined),
        icon: 'speaker',
      };
    }
    case 'alert.created':
      return ALERTS[text(d.alert_type) ?? ''] ?? { title: 'Alert raised', icon: 'alert' };
    case 'alert.acknowledged':
      return { title: 'A caregiver marked an alert as seen', icon: 'check' };
    case 'geofence.exit':
      return { title: `Left safe zone${text(d.zone) ? `: ${d.zone}` : ''}`, icon: 'safety' };
    case 'geofence.returned':
      return { title: `Back in safe zone${text(d.zone) ? `: ${d.zone}` : ''}`, icon: 'safety' };
    case 'patient.settings_changed':
      return { title: 'Changed their settings', icon: 'settings' };
    default:
      return { title: entry.event_type.replace(/[._]/g, ' '), icon: 'activity' };
  }
}
