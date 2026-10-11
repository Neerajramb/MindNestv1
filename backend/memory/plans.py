"""Spot time-bound plans in a saved conversation ("we're going to the park at 4pm") as reminder suggestions.

The model only suggests: nothing is scheduled until the patient taps "Add reminder", so a misheard
recording never creates a reminder on its own (ADR-0007 keeps structured data out of the LLM's hands).
"""

import re
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.utils import timezone

from ai.gemini import AIUnavailable
from ai.llm import generate_json
from ai.speech import Segment
from care.models import Patient
from memory.service import speaker_label
from people.models import Person

# Plans need a clock time; most of a conversation has none, so the model is only asked when one may be there.
TIME_WORDS = re.compile(
    r"\d|o'?clock|noon|midnight|half past|quarter (?:past|to)|"
    r"\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b",
    re.IGNORECASE,
)
MAX_PLANS = 5
MAX_DAYS_AHEAD = 7

SYSTEM = (
    "You read a short conversation and list plans that have a specific time of day, so they can become "
    "reminders. Only include plans with a clear clock time (e.g. 'at 4pm', 'half past nine'). Skip vague times "
    "('later', 'in the evening'), past events and general facts. Resolve 'today', 'tomorrow' and weekday names "
    "using the current date given. Write each title as a short action for the patient, e.g. 'Go to the park'. "
    "If you are told who the patient is talking with, set with_person to true for plans the patient will do "
    "together with that person (for example 'we are having lunch'), otherwise false. "
    "Use YYYY-MM-DD for date and 24-hour HH:MM for time. Return an empty list if there are none."
)

SCHEMA = {
    "type": "object",
    "properties": {
        "plans": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "date": {"type": "string"},
                    "time": {"type": "string"},
                    "with_person": {"type": "boolean"},
                },
                "required": ["title", "date", "time", "with_person"],
            },
        }
    },
    "required": ["plans"],
}


def suggest_reminders(
    patient: Patient, segments: list[Segment], person: Person | None, *, now: datetime | None = None
) -> list[dict[str, str]]:
    """Future plans as {"title", "date", "time"} in the patient's local time. Empty if the AI is unavailable."""
    tz = ZoneInfo(patient.timezone)
    local_now = (now or timezone.now()).astimezone(tz)
    transcript = "\n".join(f"{speaker_label(s.speaker, person)}: {s.text}" for s in segments)
    if not TIME_WORDS.search(transcript):
        return []
    company = ""
    if person is not None:
        relation = f", their {person.relationship.lower()}" if person.relationship else ""
        company = f"The patient is talking with {person.name}{relation}.\n"
    prompt = f"Now: {local_now:%A %d %B %Y, %H:%M}.\n{company}\nConversation:\n{transcript}"
    try:
        raw = generate_json(SYSTEM, prompt, SCHEMA).get("plans")
    except AIUnavailable:
        return []
    return _clean(raw if isinstance(raw, list) else [], local_now, person)


def _clean(raw: list[object], local_now: datetime, person: Person | None = None) -> list[dict[str, str]]:
    """Keep well-formed plans that are still ahead and within the next week, without duplicates.

    A plan made together with the person in the conversation names them ("Have lunch with Neeraj"), so the patient
    and their caregiver can tell who it is with. The name is added here rather than left to the model's wording.
    """
    plans: list[dict[str, str]] = []
    seen = set()
    for item in raw:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title", "")).strip()
        if person is not None and item.get("with_person") is True and person.name.lower() not in title.lower():
            title = f"{title} with {person.name}"
        title = title[:120]
        try:
            day = date.fromisoformat(str(item.get("date", "")))
            at = time.fromisoformat(str(item.get("time", "")))
        except ValueError:
            continue
        when = datetime.combine(day, at, tzinfo=local_now.tzinfo)
        if not title or when <= local_now or when > local_now + timedelta(days=MAX_DAYS_AHEAD):
            continue
        key = (title.lower(), day, at)
        if key in seen:
            continue
        seen.add(key)
        plans.append({"title": title, "date": day.isoformat(), "time": f"{at:%H:%M}"})
    return plans[:MAX_PLANS]
