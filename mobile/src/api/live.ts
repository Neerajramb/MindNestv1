import { uploadImage } from '@/api/upload';

export type LivePerson = { id: string; name: string; relationship: string };

export type LiveLook = {
  /** A sentence to read aloud; empty when there is nothing to say. */
  message: string;
  face: {
    status: 'RECOGNIZED' | 'UNKNOWN' | 'NO_FACE' | 'UNCLEAR';
    message: string;
    person: LivePerson | null;
    confidence: 'high' | 'medium' | null;
  } | null;
};

/** One camera frame, checked on the server for a familiar face (local, no AI quota). */
export const liveLook = (uri: string) => uploadImage<LiveLook>('/live/look', uri, 'image');
