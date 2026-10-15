// media.ts: photos and voice notes.
//
// We're on Firebase's free plan, which has no file storage. So we shrink each
// photo or voice note and save it as text (a "data URL", like "data:image/jpeg;base64,/9j/4AAQ...")
// in its own Firestore document: chats/<chatId>/media/<id>.
// One document can hold up to 1 MB, so we keep each file under about 0.9 MB.
// Later, on the paid plan, this file is the only one that changes to use real file storage.
import { doc, getDoc } from 'firebase/firestore'
import { db } from './firebase'

export const MAX_MEDIA = 900_000 // characters
export const MAX_VOICE_SECONDS = 120

// ---------- Photos ----------

// Shrink a photo until it fits: first try big and sharp, then smaller and softer.
export async function shrinkPhoto(file: File) {
  const image = await createImageBitmap(file)
  const tries: [number, number][] = [
    [1280, 0.75], // [longest side in pixels, JPEG quality]
    [1024, 0.65],
    [800, 0.55],
    [640, 0.45],
  ]
  for (const [maxSide, quality] of tries) {
    const scale = Math.min(1, maxSide / Math.max(image.width, image.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(image.width * scale)
    canvas.height = Math.round(image.height * scale)
    canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height)
    const data = canvas.toDataURL('image/jpeg', quality)
    if (data.length < MAX_MEDIA) return { data, width: canvas.width, height: canvas.height }
  }
  throw new Error('too-big')
}

// ---------- Voice notes ----------

// Starts recording from the microphone. Call stop() to get the recording back.
export async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  // Chrome records "webm", Safari records "mp4". Pick whatever this browser can do.
  const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((m) => MediaRecorder.isTypeSupported(m))
  const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 24_000 }) // low quality = small file
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => chunks.push(e.data)
  const started = Date.now()
  recorder.start()

  function finish() {
    return new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop()) // turn the microphone off
        resolve(new Blob(chunks, { type: recorder.mimeType }))
      }
      recorder.stop()
    })
  }

  return {
    started,
    // Stop and return the voice note as text, and how long it was.
    async stop() {
      const blob = await finish()
      const data = await blobToDataUrl(blob)
      if (data.length >= MAX_MEDIA) throw new Error('too-long')
      return { data, seconds: (Date.now() - started) / 1000 }
    },
    // Stop and throw it away.
    async cancel() {
      await finish()
    },
  }
}

export type Recording = Awaited<ReturnType<typeof startRecording>>

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

// ---------- Loading ----------

// Media we've already loaded (or just sent), so we don't download it twice.
const loaded = new Map<string, string>()

export function rememberMedia(mediaId: string, data: string) {
  loaded.set(mediaId, data)
}

export async function loadMedia(chatId: string, mediaId: string) {
  const known = loaded.get(mediaId)
  if (known) return known
  const snap = await getDoc(doc(db, 'chats', chatId, 'media', mediaId))
  const data = snap.get('data') as string
  loaded.set(mediaId, data)
  return data
}
