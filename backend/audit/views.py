from uuid import UUID

from django.db.models import Q, QuerySet
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.generics import ListAPIView

from accounts.models import Role
from audit.models import ActivityLog, LogCategory
from care.models import MemoryAccess
from core.permissions import IsCaregiver, IsPatientOrCaregiver, user_of
from core.scope import resolve_patient


class ActivityLogSerializer(serializers.ModelSerializer):
    actor_name = serializers.CharField(source="actor.name", default=None, read_only=True)
    actor_role = serializers.CharField(source="actor.role", default=None, read_only=True)

    class Meta:
        model = ActivityLog
        fields = ["id", "category", "event_type", "event_data", "actor_name", "actor_role", "created_at"]
        read_only_fields = fields


@extend_schema(tags=["activity"])
class PatientActivityView(ListAPIView):
    """Patient-facing and caregiver-facing activity history (CARE-06, FR-024)."""

    permission_classes = [IsPatientOrCaregiver]
    serializer_class = ActivityLogSerializer
    category = LogCategory.ACTIVITY

    def get_queryset(self) -> QuerySet[ActivityLog]:
        patient_id: UUID = self.kwargs["patient_id"]
        user = user_of(self.request)
        patient = resolve_patient(user, patient_id)
        entries = ActivityLog.objects.filter(patient=patient, category=self.category).select_related("actor")
        # "Added a reminder" already says it; the matching alert stays in the Alerts tab.
        entries = entries.exclude(event_type="alert.created", event_data__alert_type="PATIENT_REMINDER")
        if user.role == Role.CAREGIVER and patient.caregiver_memory_access == MemoryAccess.NONE:
            entries = entries.exclude(
                Q(event_type__startswith="memory.") | Q(event_type="assistant.query", event_data__intent="MEMORY")
            )
        return entries


@extend_schema(tags=["activity"])
class PatientAuditView(PatientActivityView):
    """Security and configuration events; caregivers only."""

    permission_classes = [IsCaregiver]
    category = LogCategory.AUDIT
