# Project State (resume here)

Last updated: 2026-10-11, MindNest v1 (semester 1 scope).

## Where things are

- Plan: the project is delivered over two semesters. This repository is **v1**, the semester 1 build.
- Done in v1: **P1** foundation, **P2** auth/RBAC/data model, **P3** schedule/medication/reminders/alerts,
  **P4** patient and caregiver mobile app, **P5a** safety (geofencing, SOS), **P8** face recognition
  ("Who is this?" and the Live companion), **P9+P10** conversational memory and the "Ask me" assistant.
- Planned for semester 2 (v2): object finder (room scans, "where did I leave my keys?"), belongings and rooms
  for caregivers, AR Vision, the "Hey MindNest" wake word, P11 well-being audio.

## v1 feature set

| Area | Patient | Caregiver |
|---|---|---|
| Daily routine | Home, My day, Reminders, My medicines, add a reminder | Schedule, appointments, medications, reminder status |
| Assistant | "Ask me" (typed or spoken), answers from schedule, medicines and saved conversations | — |
| Faces | "Who is this?", Live companion (names familiar people as they appear) | Familiar people and their photos |
| Memory | Live recording, My memories (record, note, look back, suggested reminders) | Conversations (as the patient allows) |
| Safety | Where am I, Help/SOS, location sharing | Location and safe zones, alerts, emergency contacts |
| Other | Settings (text size, voice, privacy) | Activity log, link codes |

## Next exact task

Semester 2: object finder (FR-009..011), then well-being (FR-023), AR Vision and the wake word.

## Last gate results (v1)

| Check | Result |
|---|---|
| Backend `pytest` | 164 passed |
| Backend `ruff`, `mypy` | Clean (131 files) |
| Mobile `tsc`, `expo lint`, `jest` | Clean, 18 passed |
| Android bundle export | Builds |

Run locally: `python manage.py runserver 0.0.0.0:8000` and `python manage.py run_huey` (two terminals).
Demo accounts (fictional): `python manage.py seed_demo` → `carol` (caregiver), `thomas` (patient).
