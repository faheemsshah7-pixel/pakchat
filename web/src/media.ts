// media.ts: photos and voice notes.
//
// We're on Firebase's free plan, which has no file storage. So we save each photo or
// voice note as text (a "data URL", like "data:image/jpeg;base64,/9j/4AAQ...")
// in Firestore documents: chats/<chatId>/media/<id>.
// One document can hold up to 1 MB. A photo is shrunk to fit in one.
// A voice note is recorded in good quality, so a long one is cut into parts:
//   media/<id> (the first part, and how many parts there are), media/<id>_2, media/<id>_3 ...
// Later, on the paid plan, this file is the only one that changes to use real file storage.
import { useEffect, useState } from 'react'
import { collection, doc, getDoc, type DocumentReference, type Timestamp, type WriteBatch } from 'firebase/firestore'
import { db } from './firebase'

export const MAX_MEDIA = 900_000 // characters in one document
export const MAX_PARTS = 8 // documents for one voice note (a 5-minute note needs about 4)
export const MAX_VOICE_SECONDS = 300 // 5 minutes
export const MAX_PHOTOS = 10 // photos you can send at once
export const VOICE_QUALITY = 64_000 // bits per second: very clear speech at a sensible size (WhatsApp uses about 16,000-24,000)

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

// A profile or group photo: a square cut from the middle, small enough to load fast.
export async function shrinkAvatar(file: File) {
  const image = await createImageBitmap(file)
  const side = Math.min(image.width, image.height)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 320
  canvas.getContext('2d')!.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, 320, 320)
  return canvas.toDataURL('image/jpeg', 0.8)
}

// ---------- Voice notes ----------

// Starts recording from the microphone. Call stop() to get the recording back.
export async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1, // one voice, so mono
      sampleRate: 48_000, // the highest the voice format uses (CD quality is 44,100)
      echoCancellation: false, // nothing is playing while you record, so nothing to cancel
      noiseSuppression: true, // quieter background (traffic, fans)
      autoGainControl: true, // evens out loud and soft speech
    },
  })
  // Chrome records "webm", Safari records "mp4". Pick whatever this browser can do.
  const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((m) => MediaRecorder.isTypeSupported(m))
  const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: VOICE_QUALITY })
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
      if (data.length > MAX_MEDIA * MAX_PARTS) throw new Error('too-long')
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

// ---------- Saving and loading ----------

// Media we've already loaded (or just sent), so we don't download it twice.
const loaded = new Map<string, string>()

// The document for part 1, 2, 3 ... of a file.
function partRef(chatId: string, mediaId: string, part: number) {
  return doc(db, 'chats', chatId, 'media', part === 1 ? mediaId : `${mediaId}_${part}`)
}

// Adds a photo or voice note to a batch of writes, cut into parts if needed. Returns its id.
// expireAt: it's in a disappearing message, so it goes when the message does.
export function saveMedia(batch: WriteBatch, chatRef: DocumentReference, data: string, senderId: string, expireAt?: Timestamp) {
  const mediaId = doc(collection(chatRef, 'media')).id // a new random id
  const parts = Math.ceil(data.length / MAX_MEDIA)
  for (let part = 1; part <= parts; part++) {
    const piece = data.slice((part - 1) * MAX_MEDIA, part * MAX_MEDIA)
    const fields: Record<string, unknown> = { data: piece, senderId }
    if (part === 1 && parts > 1) fields.parts = parts
    if (expireAt) fields.expireAt = expireAt
    batch.set(partRef(chatRef.id, mediaId, part), fields)
  }
  loaded.set(mediaId, data) // so YOUR bubble shows it straight away
  return mediaId
}

// Adds deleting a photo or voice note (all its parts) to a batch of writes.
export async function deleteMedia(batch: WriteBatch, chatId: string, mediaId: string) {
  const known = loaded.get(mediaId)
  const parts = known ? Math.ceil(known.length / MAX_MEDIA) : (((await getDoc(partRef(chatId, mediaId, 1))).get('parts') as number) ?? 1)
  for (let part = 1; part <= parts; part++) batch.delete(partRef(chatId, mediaId, part))
  loaded.delete(mediaId)
}

export async function loadMedia(chatId: string, mediaId: string) {
  const known = loaded.get(mediaId)
  if (known) return known
  const first = await getDoc(partRef(chatId, mediaId, 1))
  let data = first.get('data') as string
  const parts = (first.get('parts') as number) ?? 1
  if (parts > 1) {
    const rest = await Promise.all(Array.from({ length: parts - 1 }, (_, i) => getDoc(partRef(chatId, mediaId, i + 2))))
    data += rest.map((snap) => snap.get('data') as string).join('')
  }
  loaded.set(mediaId, data)
  return data
}

// A photo or voice note for a screen: null while it's loading.
export function useMedia(chatId: string, mediaId: string | undefined) {
  const [data, setData] = useState<{ id: string; data: string } | null>(null)
  useEffect(() => {
    if (!mediaId) return
    let stillHere = true
    loadMedia(chatId, mediaId)
      .then((loaded) => stillHere && setData({ id: mediaId, data: loaded }))
      .catch(console.error)
    return () => {
      stillHere = false
    }
  }, [chatId, mediaId])
  // (If the photo changed, don't show the old one while the new one loads.)
  return mediaId && data?.id === mediaId ? data.data : null
}
