"""Live companion look: familiar faces from one camera frame (FR-012..014)."""

import io
from typing import Any

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image

from people.models import Person
from people.service import Recognition

pytestmark = pytest.mark.django_db


@pytest.fixture
def faces(monkeypatch: pytest.MonkeyPatch) -> dict[str, Recognition]:
    state = {"result": Recognition("NO_FACE")}
    monkeypatch.setattr("assistant.live.get_face_engine", lambda: object())
    monkeypatch.setattr("assistant.live.recognize", lambda engine, patient, rgb: state["result"])
    return state


def _photo() -> SimpleUploadedFile:
    buffer = io.BytesIO()
    Image.new("RGB", (64, 64), (200, 180, 160)).save(buffer, format="JPEG")
    return SimpleUploadedFile("look.jpg", buffer.getvalue(), content_type="image/jpeg")


def _look(world: dict[str, Any]) -> Any:
    return world["pat_client"].post("/api/v1/live/look", {"image": _photo()}, format="multipart")


def test_look_names_a_familiar_person(world: dict[str, Any], faces: dict[str, Any]) -> None:
    neeraj = Person.objects.create(patient=world["pat"], name="Neeraj", relationship="Friend", consent_confirmed=True)
    faces["result"] = Recognition("RECOGNIZED", neeraj, "high")

    response = _look(world)
    assert response.status_code == 200, response.json()
    data = response.json()["data"]
    assert data["face"]["person"]["name"] == "Neeraj"
    assert data["message"] == "This looks like Neeraj, your friend."


def test_no_face_says_nothing_and_unknown_face_says_not_sure(world: dict[str, Any], faces: dict[str, Any]) -> None:
    data = _look(world).json()["data"]
    assert data["message"] == "" and data["face"]["status"] == "NO_FACE"
    faces["result"] = Recognition("UNKNOWN")
    assert _look(world).json()["data"]["message"] == "I'm not sure who this is."


def test_live_look_is_for_the_patient_only(world: dict[str, Any], faces: dict[str, Any]) -> None:
    response = world["carol_client"].post("/api/v1/live/look", {"image": _photo()}, format="multipart")
    assert response.status_code == 403
