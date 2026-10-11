"""Live companion: one camera frame answers "who is with me?".

Faces are checked locally on the server (no AI quota), so the phone can send a frame every few seconds while the
Live screen is open. The photo is never stored.
"""

from typing import Any

from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from ai.face import FaceModelsMissing, get_face_engine
from audit.service import log_event
from core.media import read_image
from core.permissions import IsPatient, user_of
from core.scope import own_patient
from people.service import Recognition, recognize


class LookSerializer(serializers.Serializer):
    image = serializers.FileField()


def compose_message(face: Recognition | None) -> str:
    if face is not None and face.status in ("RECOGNIZED", "UNKNOWN"):
        return str(face.as_dict()["message"])
    return ""


@extend_schema(tags=["assistant"])
class LiveLookView(APIView):
    permission_classes = [IsPatient]
    parser_classes = [MultiPartParser, FormParser]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "ai"

    @extend_schema(request={"multipart/form-data": LookSerializer})
    def post(self, request: Request) -> Response:
        user = user_of(request)
        patient = own_patient(user)
        serializer = LookSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        rgb = read_image(serializer.validated_data["image"])

        face: Recognition | None = None
        try:
            face = recognize(get_face_engine(), patient, rgb)
        except FaceModelsMissing:
            face = None
        if face is not None and face.status in ("RECOGNIZED", "UNKNOWN"):
            log_event(
                "face.recognition",
                actor=user,
                patient=patient,
                result=face.status,
                person=face.person.name if face.person else None,
                live=True,
            )

        data: dict[str, Any] = {
            "message": compose_message(face),
            "face": face.as_dict() if face is not None else None,
        }
        return Response(data)
