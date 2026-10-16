// videoNotes.ts: round video messages, like WhatsApp's. Tap the round camera button next to
// the microphone, talk to your front camera for up to a minute, and send. It plays in a circle.
//
// It's saved like any other video (media.ts), with round: true, so it can be at most about 5 MB.
// A minute at 550,000 bits a second for the picture plus 48,000 for the sound is about 4.5 MB.
import { blobToDataUrl, MAX_FILE_BYTES } from './media'

export const MAX_NOTE_SECONDS = 60
const VIDEO_BITS = 550_000
const AUDIO_BITS = 48_000

// Turn on the front camera and the microphone. A square-ish picture is asked for, since it's shown in a circle.
// facing: 'user' = the front camera, 'environment' = the back one (phones).
export function openCamera(facing: 'user' | 'environment' = 'user') {
  return navigator.mediaDevices.getUserMedia({
    video: { facingMode: facing, width: { ideal: 480 }, height: { ideal: 480 }, aspectRatio: { ideal: 1 }, frameRate: { ideal: 24, max: 30 } },
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  })
}

// Turn the camera and microphone off (the little light goes out).
export function closeCamera(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop())
}

// Start recording what the camera sees. stop() gives the video back as a Blob.
export function recordNote(stream: MediaStream) {
  // H.264 MP4 plays on every phone, so that first. (Then WebM, which Chrome always can.)
  const mimeType = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/webm;codecs=vp8,opus', 'video/mp4', 'video/webm'].find((type) => MediaRecorder.isTypeSupported(type))
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: VIDEO_BITS, audioBitsPerSecond: AUDIO_BITS })
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data)
  }
  const started = Date.now()
  recorder.start(1000) // (a piece every second, so nothing is lost if it stops suddenly)
  return {
    started,
    stop() {
      return new Promise<{ blob: Blob; seconds: number }>((resolve) => {
        const seconds = Math.min(MAX_NOTE_SECONDS, (Date.now() - started) / 1000)
        if (recorder.state === 'inactive') return resolve({ blob: new Blob(chunks, { type: recorder.mimeType }), seconds })
        recorder.onstop = () => resolve({ blob: new Blob(chunks, { type: recorder.mimeType }), seconds })
        recorder.stop()
      })
    },
  }
}

export type NoteRecording = ReturnType<typeof recordNote>

// A square picture from the middle of what the camera shows, for the bubble before it plays.
export function grabPoster(video: HTMLVideoElement) {
  const side = Math.min(video.videoWidth, video.videoHeight)
  if (!side) return ''
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 320
  canvas.getContext('2d')!.drawImage(video, (video.videoWidth - side) / 2, (video.videoHeight - side) / 2, side, side, 0, 0, 320, 320)
  return canvas.toDataURL('image/jpeg', 0.7)
}

// Everything the message needs. Throws 'too-big' if it doesn't fit.
export async function noteContent(blob: Blob, seconds: number, poster: string, width: number, height: number) {
  if (blob.size > MAX_FILE_BYTES) throw new Error('too-big')
  return { kind: 'video' as const, data: await blobToDataUrl(blob), poster, width, height, seconds: Math.max(1, Math.round(seconds)), round: true }
}
