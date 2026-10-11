"""Caregiver activity: what the patient did, in enough detail to follow their day (CARE-06, FR-024)."""

import io
from datetime import date, timedelta
from typing import Any

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from PIL import Image

from audit.service import log_event
from care.models import MemoryAccess
from people.models import Person
from people.service import Recognition

pytestmark = pytest.mark.django_db


def _activity(world: dict[str, Any], client: str = "carol_client") -> list[dict[str, Any]]:
    response = world[client].get(f"/api/v1/patients/{world['pat'].id}/activity")
    assert response.status_code == 200, response.json()
    return list(response.json()["data"])


def _types(entries: list[dict[str, Any]]) -> list[str]:
    return [e["event_type"] for e in entries]


def test_patient_reminder_from_a_conversation_shows_what_and_when(world: dict[str, Any]) -> None:
    tomorrow = timezone.localdate() + timedelta(days=1)
    body = {
        "title": "Have lunch with Neeraj",
        "scheduled_time": "15:00",
        "start_date": tomorrow.isoformat(),
        "end_date": tomorrow.isoformat(),
        "recurrence_rule": "FREQ=DAILY",
        "source": "conversation",
    }
    response = world["pat_client"].post(f"/api/v1/patients/{world['pat'].id}/schedule", body, format="json")
    assert response.status_code == 201, response.json()

    added = next(e for e in _activity(world) if e["event_type"] == "reminder.added")
    assert added["event_data"]["title"] == "Have lunch with Neeraj"
    assert added["event_data"]["summary"].startswith("Have lunch with Neeraj at 3:00 pm on ")
    assert added["event_data"]["from_conversation"] is True
    assert added["actor_role"] == "PATIENT"
    assert "alert.created" not in _types(_activity(world))  # the alert itself is in the Alerts tab


def test_caregiver_routines_are_not_patient_activity(world: dict[str, Any]) -> None:
    body = {"title": "Walk", "scheduled_time": "08:00", "start_date": date.today().isoformat()}
    assert world["carol_client"].post(f"/api/v1/patients/{world['pat'].id}/schedule", body, format="json").status_code
    assert "reminder.added" not in _types(_activity(world))


def _photo() -> SimpleUploadedFile:
    buffer = io.BytesIO()
    Image.new("RGB", (64, 64), (200, 180, 160)).save(buffer, format="JPEG")
    return SimpleUploadedFile("look.jpg", buffer.getvalue(), content_type="image/jpeg")


def test_live_logs_a_person_once_not_every_frame(world: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> None:
    neeraj = Person.objects.create(patient=world["pat"], name="Neeraj", relationship="Friend", consent_confirmed=True)
    monkeypatch.setattr("assistant.live.get_face_engine", lambda: object())
    monkeypatch.setattr("assistant.live.recognize", lambda e, p, rgb: Recognition("RECOGNIZED", neeraj, "high"))
    for _ in range(3):
        world["pat_client"].post("/api/v1/live/look", {"image": _photo()}, format="multipart")

    sightings = [e for e in _activity(world) if e["event_type"] == "face.recognition"]
    assert len(sightings) == 1
    assert sightings[0]["event_data"] == {"result": "RECOGNIZED", "person": "Neeraj", "via": "live"}


def test_conversation_activity_follows_the_patients_privacy_choice(world: dict[str, Any]) -> None:
    patient = world["pat"]
    log_event("memory.saved", actor=patient.user, patient=patient, source="VOICE", person="Neeraj", chunks=1)
    log_event("assistant.query", actor=patient.user, patient=patient, intent="MEMORY", used_llm=True)
    log_event("assistant.query", actor=patient.user, patient=patient, intent="MEDICATION", used_llm=False)

    assert _types(_activity(world)).count("memory.saved") == 1  # default: dates and people

    patient.caregiver_memory_access = MemoryAccess.NONE
    patient.save(update_fields=["caregiver_memory_access"])
    entries = _activity(world)
    assert "memory.saved" not in _types(entries)
    assert [e["event_data"]["intent"] for e in entries if e["event_type"] == "assistant.query"] == ["MEDICATION"]
    assert "memory.saved" in _types(_activity(world, "pat_client"))  # the patient always sees their own
