import { useQueryClient } from '@tanstack/react-query';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Stack, useFocusEffect, useNavigation } from 'expo-router';
import * as Speech from 'expo-speech';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Linking, View } from 'react-native';

import { errorMessage } from '@/api/client';
import { useMyPatient } from '@/api/hooks';
import { liveLook, type LivePerson } from '@/api/live';
import { usePatientId } from '@/features/patient-context';
import { uploadAudio, useVoiceRecorder } from '@/features/voice-recorder';
import { Button } from '@/ui/button';
import { Card } from '@/ui/card';
import { NamedIcon } from '@/ui/icon';
import { Screen } from '@/ui/screen';
import { InlineNotice } from '@/ui/states';
import { AppText } from '@/ui/text';
import { colors, radius, space } from '@/ui/theme';

/** How often a frame is checked for a familiar face (local on the server, no AI quota). */
const FACE_CHECK_MS = 6000;
const MAX_RECORDING_SECONDS = 300;

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/**
 * Live companion: a familiar face is announced when it appears, and the conversation can be saved as a memory
 * linked to that person.
 */
export default function Live() {
  const client = useQueryClient();
  const navigation = useNavigation();
  const patientId = usePatientId();
  const voice = useMyPatient().data?.voice_responses_enabled ?? true;
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [person, setPerson] = useState<LivePerson | null>(null);
  const [looking, setLooking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Refs keep the polling timer and recorder callbacks reading current values.
  const frameBusy = useRef(false);
  const personRef = useRef<LivePerson | null>(null);
  const recordingRef = useRef(false);

  const say = useCallback(
    (text: string) => {
      if (!text) return;
      setMessage(text);
      // Stay quiet while recording so MindNest's voice does not end up in the saved conversation.
      if (voice && !recordingRef.current) {
        Speech.stop();
        Speech.speak(text, { rate: 0.9 });
      }
    },
    [voice],
  );

  const rememberPerson = (seen: LivePerson | null) => {
    if (!seen) return false;
    const isNew = seen.id !== personRef.current?.id;
    personRef.current = seen;
    setPerson(seen);
    return isNew;
  };

  const capture = async () =>
    (await camera.current?.takePictureAsync({ quality: 0.4, shutterSound: false, skipProcessing: true }))?.uri ?? null;

  /** `announce` reads out every result (the person asked); otherwise only a newly recognised person is announced. */
  const checkFace = async (announce: boolean) => {
    if (!camera.current) return;
    if (announce) {
      // A background check may be mid-flight; wait for it rather than skipping the check the person asked for.
      for (let i = 0; frameBusy.current && i < 20; i++) await new Promise((r) => setTimeout(r, 250));
      setLooking(true);
      setError(null);
    } else if (frameBusy.current) {
      return;
    }
    frameBusy.current = true;
    try {
      const uri = await capture();
      if (!uri) return;
      const result = await liveLook(uri);
      const seen = result.face?.status === 'RECOGNIZED' ? result.face.person : null;
      const isNew = rememberPerson(seen);
      if (announce) say(result.message || 'I cannot see a face. Point the camera at the person you are with.');
      else if (isNew && result.face) say(result.face.message);
    } catch (err) {
      // Background checks stay quiet on purpose: the next one retries.
      if (announce) setError(errorMessage(err));
    } finally {
      frameBusy.current = false;
      if (announce) setLooking(false);
    }
  };

  const checkFaceRef = useRef(checkFace);
  useEffect(() => {
    checkFaceRef.current = checkFace;
  });

  // Familiar-face checks run only while this screen is in front, starting as soon as the camera is ready.
  useFocusEffect(
    useCallback(() => {
      if (!ready) return undefined;
      void checkFaceRef.current(false);
      const id = setInterval(() => void checkFaceRef.current(false), FACE_CHECK_MS);
      return () => clearInterval(id);
    }, [ready]),
  );

  const saveRecording = async (uri: string) => {
    recordingRef.current = false;
    const withWhom = personRef.current;
    setSaving(true);
    setError(null);
    try {
      await uploadAudio('/conversations/record', uri, {
        consent_confirmed: 'true',
        ...(withWhom ? { person_id: withWhom.id } : {}),
      });
      if (patientId) void client.invalidateQueries({ queryKey: ['patient', patientId, 'conversations'] });
      say(
        withWhom
          ? `I saved your conversation with ${withWhom.name}. You can ask me about it later.`
          : 'I saved the conversation. You can ask me about it later.',
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const recorder = useVoiceRecorder(MAX_RECORDING_SECONDS, (uri) => void saveRecording(uri));

  const startRecording = async () => {
    setError(null);
    Speech.stop();
    if (!(await recorder.start())) {
      setError('MindNest needs the microphone to remember the conversation.');
      return;
    }
    recordingRef.current = true;
    setMessage(null);
  };

  const stopRecording = async () => {
    const uri = await recorder.stop();
    if (uri) await saveRecording(uri);
    else recordingRef.current = false;
  };
  const stopRecordingRef = useRef(stopRecording);
  useEffect(() => {
    stopRecordingRef.current = stopRecording;
  });

  // Leaving mid-conversation asks first, so a recording is never lost by accident.
  useEffect(
    () =>
      navigation.addListener('beforeRemove', (event) => {
        if (!recordingRef.current) return;
        event.preventDefault();
        Alert.alert('Save this conversation?', 'You are still recording.', [
          { text: 'Keep recording', style: 'cancel' },
          {
            text: 'Save and leave',
            onPress: () =>
              void stopRecordingRef.current().finally(() => navigation.dispatch(event.data.action)),
          },
        ]);
      }),
    [navigation],
  );

  if (!permission) return null;
  if (!permission.granted) {
    return (
      <Screen>
        <AppText variant="title">MindNest needs the camera</AppText>
        <AppText>
          Point the camera at the person you are with. MindNest will tell you who they are and can remember your
          conversation. Photos are not kept.
        </AppText>
        {permission.canAskAgain ? (
          <Button label="Allow camera" icon="camera" onPress={() => void requestPermission()} large />
        ) : (
          <Button label="Open phone settings" icon="settings" onPress={() => void Linking.openSettings()} large />
        )}
      </Screen>
    );
  }

  const withWhom = person ? `${person.name}${person.relationship ? `, your ${person.relationship.toLowerCase()}` : ''}` : null;
  const recording = recorder.recording;

  return (
    <Screen>
      <Stack.Screen options={{ gestureEnabled: !recording }} />
      <View style={{ height: 320, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#000' }}>
        <CameraView
          ref={camera}
          style={{ flex: 1 }}
          facing={facing}
          mute
          animateShutter={false}
          onCameraReady={() => setReady(true)}
          accessibilityLabel="Camera view"
        />
        {recording ? (
          <View
            style={{
              position: 'absolute',
              top: space.md,
              left: space.md,
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.xs,
              backgroundColor: colors.danger,
              borderRadius: radius.pill,
              paddingHorizontal: space.md,
              paddingVertical: space.xs,
            }}
          >
            <NamedIcon name="mic" size={18} color={colors.onPrimary} />
            <AppText variant="bodyStrong" color={colors.onPrimary}>
              {`Recording ${clock(recorder.seconds)}`}
            </AppText>
          </View>
        ) : null}
      </View>

      {message ? (
        <Card tint={colors.primarySoft}>
          <AppText variant="title" accessibilityLiveRegion="polite">
            {message}
          </AppText>
        </Card>
      ) : null}

      <Card>
        <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
          <NamedIcon name="person" size={28} color={person ? colors.primary : colors.textMuted} />
          <View style={{ flex: 1 }}>
            <AppText variant="caption" color={colors.textMuted}>
              Who is with you
            </AppText>
            <AppText variant="bodyStrong" color={person ? colors.text : colors.textMuted}>
              {withWhom ?? (looking ? 'Looking…' : 'No one I know yet')}
            </AppText>
          </View>
        </View>
      </Card>

      {error ? <InlineNotice tone="danger" message={error} /> : null}

      {recording ? (
        <Button
          label={person ? `Stop and save talk with ${person.name}` : 'Stop and save conversation'}
          tone="danger"
          icon="stop"
          onPress={() => void stopRecording()}
          large
        />
      ) : (
        <View style={{ gap: space.xs }}>
          <Button
            label={person ? `Remember my talk with ${person.name}` : 'Remember this conversation'}
            icon="mic"
            onPress={() => void startRecording()}
            loading={saving}
            large
          />
          <AppText variant="caption" color={colors.textMuted}>
            Only record when everyone here agrees. Tapping this confirms they do.
          </AppText>
        </View>
      )}

      <Button
        label={looking ? 'Looking…' : 'Who is this?'}
        tone="secondary"
        icon="person"
        onPress={() => void checkFace(true)}
        loading={looking}
      />
      <Button
        label={facing === 'back' ? 'Use front camera' : 'Use back camera'}
        tone="ghost"
        icon="camera"
        onPress={() => setFacing(facing === 'back' ? 'front' : 'back')}
      />
      <AppText variant="caption" color={colors.textMuted}>
        Photos are checked only against people your caregiver added, then discarded. Recordings are turned into text
        and the audio is not kept.
      </AppText>
    </Screen>
  );
}
