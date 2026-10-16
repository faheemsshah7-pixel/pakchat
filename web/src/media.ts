// media.ts: photos, videos, voice notes and documents.
//
// We're on Firebase's free plan, which has no file storage. So we save each photo or
// voice note as text (a "data URL", like "data:image/jpeg;base64,/9j/4AAQ...")
// in Firestore documents: chats/<chatId>/media/<id>.
// One document can hold up to 1 MB. A photo is shrunk to fit in one.
// Bigger things (voice notes, videos, documents) are cut into parts, up to 8:
//   media/<id> (the first part, and how many parts there are), media/<id>_2, media/<id>_3 ...
// So the biggest file we can send is about 5 MB. Bigger videos are made smaller first.
// Later, on the paid plan, this file is the only one that changes to use real file storage.
import { useEffect, useState } from 'react'
import { collection, doc, getDoc, type DocumentReference, type Timestamp, type WriteBatch } from 'firebase/firestore'
import { db } from './firebase'
import { startTranscript, type Language } from './transcribe'

export const MAX_MEDIA = 900_000 // characters in one document
export const MAX_PARTS = 8 // documents for one voice note (a 5-minute note needs about 4)
export const MAX_VOICE_SECONDS = 300 // 5 minutes
export const MAX_PHOTOS = 10 // photos you can send at once
export const VOICE_QUALITY = 64_000 // bits per second: very clear speech at a sensible size (WhatsApp uses about 16,000-24,000)
// The biggest file that fits: 8 parts of text, and text takes 4 letters for every 3 bytes.
export const MAX_FILE_BYTES = Math.floor((MAX_MEDIA * MAX_PARTS * 3) / 4) - 1000
export const MAX_VIDEO_SECONDS = 180 // 3 minutes

// ---------- Photos ----------

// [longest side in pixels, JPEG quality]: first try big and sharp, then smaller and softer.
const STANDARD: [number, number][] = [
  [1280, 0.75],
  [1024, 0.65],
  [800, 0.55],
  [640, 0.45],
]
// HD photos are about twice as sharp, and can take up to 3 parts (about 2 MB).
export const HD_SIDE = 2560
const HD: [number, number][] = [
  [HD_SIDE, 0.85],
  [2048, 0.82],
  [1600, 0.8],
]
const HD_PARTS = 3

// Shrink a photo until it fits. hd: try the HD sizes first.
// Returns hd: true only if it really came out in HD.
export async function shrinkPhoto(file: Blob, hd = false) {
  const image = await createImageBitmap(file)
  const tries = [...(hd ? HD.map(([side, quality]) => [side, quality, MAX_MEDIA * HD_PARTS, 1]) : []), ...STANDARD.map(([side, quality]) => [side, quality, MAX_MEDIA, 0])]
  for (const [maxSide, quality, room, isHD] of tries) {
    // (A small photo isn't made bigger, so "HD" only counts if it's bigger than the standard size.)
    if (isHD && Math.max(image.width, image.height) <= STANDARD[0][0]) continue
    const scale = Math.min(1, maxSide / Math.max(image.width, image.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(image.width * scale)
    canvas.height = Math.round(image.height * scale)
    canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height)
    const data = canvas.toDataURL('image/jpeg', quality)
    if (data.length < room) return { data, width: canvas.width, height: canvas.height, hd: !!isHD }
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
// transcribe: also write out the words, in this language (transcribe.ts).
export async function startRecording(transcribe?: Language) {
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
  const words = transcribe ? startTranscript(transcribe) : null

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
    // Stop and return the voice note as text, how long it was, and its words (if any).
    async stop() {
      const seconds = (Date.now() - started) / 1000
      const [blob, transcript] = await Promise.all([finish(), words?.stop() ?? ''])
      const data = await blobToDataUrl(blob)
      if (data.length > MAX_MEDIA * MAX_PARTS) throw new Error('too-long')
      return { data, seconds, transcript } // (transcript is '' if there are no words)
    },
    // Stop and throw it away.
    async cancel() {
      words?.cancel()
      await finish()
    },
  }
}

export type Recording = Awaited<ReturnType<typeof startRecording>>

// (A recording's type can have a comma in it, like "video/webm;codecs=vp8,opus". A comma ends the
// type part of a data URL, so the video would come back broken. So only "video/webm" is kept:
// the video file itself says which codecs it uses.)
export function blobToDataUrl(blob: Blob) {
  const plain = blob.type.includes(';') ? new Blob([blob], { type: blob.type.split(';')[0] }) : blob
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(plain)
  })
}

// Videos sent before that fix start "data:video/mp4;codecs=avc1.42E01E,mp4a.40.2;base64,".
// This mends them, so they play: "data:video/mp4;base64,".
function mendType(data: string) {
  const start = data.slice(0, 120)
  const at = start.indexOf(';base64,')
  if (at < 0 || !start.slice(0, at).includes(',')) return data
  return start.slice(0, start.indexOf(';')) + data.slice(at)
}

// ---------- Videos ----------

// Photos and videos get a preview before sending (PhotoSender.tsx). Other files go as documents.
export const isPhotoOrVideo = (file: File) => file.type.startsWith('image/') || file.type.startsWith('video/')

// Get a video ready to send: its first picture (the "poster" shown in the chat), its size and
// length, and the video itself as text. A video that's too big, or in a format other phones
// might not play (like an iPhone's .mov), is played through once and recorded again smaller.
// That takes as long as the video. onProgress gets 0 to 1 while it happens.
export async function prepareVideo(file: File, onProgress: (done: number) => void, maxSeconds = MAX_VIDEO_SECONDS) {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.src = url
  try {
    await happens(video, 'loadeddata')
    const seconds = await lengthOf(video)
    if (seconds > maxSeconds) throw new Error('too-long')
    const width = video.videoWidth
    const height = video.videoHeight
    if (!width || !height) throw new Error('cant-play')
    const poster = await grabFrame(video, Math.min(0.5, seconds / 2))
    const plays = ['video/mp4', 'video/webm'].includes(file.type) // formats every browser plays
    const blob = plays && file.size <= MAX_FILE_BYTES ? file : await shrinkVideo(video, seconds, onProgress)
    if (blob.size > MAX_FILE_BYTES) throw new Error('too-big')
    return { data: await blobToDataUrl(blob), poster, width, height, seconds }
  } finally {
    // Let go of the file: no src, and load() so the video stops reading it.
    video.pause()
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }
}

// Wait for something to happen to a video (like 'loadeddata': its first picture is ready).
function happens(video: HTMLVideoElement, event: string) {
  return new Promise<void>((resolve, reject) => {
    video.addEventListener(event, () => resolve(), { once: true })
    video.addEventListener('error', () => reject(new Error('cant-play')), { once: true })
  })
}

// How long a video is. Videos recorded in a browser sometimes don't say, until you jump to the end.
async function lengthOf(video: HTMLVideoElement) {
  if (Number.isFinite(video.duration)) return video.duration
  video.currentTime = 1e9
  await happens(video, 'seeked')
  const seconds = video.duration
  video.currentTime = 0
  await happens(video, 'seeked')
  return Number.isFinite(seconds) ? seconds : video.currentTime
}

// One picture from the video, small, as a JPEG.
async function grabFrame(video: HTMLVideoElement, at: number) {
  video.currentTime = at
  await happens(video, 'seeked')
  const scale = Math.min(1, 480 / Math.max(video.videoWidth, video.videoHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(video.videoWidth * scale)
  canvas.height = Math.round(video.videoHeight * scale)
  canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.7)
}

// The sound of a video goes through here while it's recorded again. Browsers only let sound
// start right after a tap, so warmUpSound() is called the moment you press Send.
let sound: AudioContext | null = null
export function warmUpSound() {
  sound ??= new AudioContext()
  sound.resume().catch(() => {})
}

// Play the video once, drawing it smaller onto a canvas, and record the canvas and the sound.
// The quality is picked so the result fits in about 5 MB.
async function shrinkVideo(video: HTMLVideoElement, seconds: number, onProgress: (done: number) => void) {
  const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round((video.videoWidth * scale) / 2) * 2 // (even sizes work best)
  canvas.height = Math.round((video.videoHeight * scale) / 2) * 2
  const draw = canvas.getContext('2d')!
  const stream = canvas.captureStream(30)
  // The sound goes into the recording only, not to the speakers, so you don't hear it play.
  warmUpSound()
  const source = sound!.createMediaElementSource(video)
  const out = sound!.createMediaStreamDestination()
  source.connect(out)
  out.stream.getAudioTracks().forEach((track) => stream.addTrack(track))

  // H.264 MP4 plays on every phone, so that first. (Then WebM, which Chrome always can.)
  const mimeType = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/webm;codecs=vp8,opus', 'video/mp4', 'video/webm'].find((type) =>
    MediaRecorder.isTypeSupported(type),
  )
  const bits = (MAX_FILE_BYTES * 8 * 0.85) / Math.max(seconds, 1) // bits per second that fit
  const videoBits = Math.round(Math.min(1_500_000, Math.max(150_000, bits - 64_000)))
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: videoBits, audioBitsPerSecond: 64_000 })
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => chunks.push(e.data)
  const stopped = new Promise((resolve) => (recorder.onstop = resolve))

  video.currentTime = 0
  await happens(video, 'seeked')
  video.muted = false // (a muted video would record silence)
  recorder.start(1000)
  // If the browser won't play sound without a tap, record it without sound rather than not at all.
  await video.play().catch(() => {
    video.muted = true
    return video.play()
  })
  let finished = false
  const paint = () => {
    if (finished) return
    draw.drawImage(video, 0, 0, canvas.width, canvas.height)
    onProgress(Math.min(1, video.currentTime / seconds))
    requestAnimationFrame(paint)
  }
  paint()
  await happens(video, 'ended')
  finished = true
  recorder.stop()
  await stopped
  source.disconnect()
  stream.getTracks().forEach((track) => track.stop())
  return new Blob(chunks, { type: recorder.mimeType })
}

// ---------- Documents ----------

// "850 KB", "1.2 MB"
export function sizeText(bytes = 0) {
  if (bytes < 1000_000) return `${Math.max(1, Math.round(bytes / 1000))} KB`
  return `${(bytes / 1000_000).toFixed(1)} MB`
}

// ---------- Saving and loading ----------

// Media we've already loaded (or just sent), so we don't download it twice.
const loaded = new Map<string, string>()

// Where a file's parts are kept: under a chat ("chats/<id>") or a status ("statuses/<id>").
// The document for part 1, 2, 3 ... of a file:
function partRef(place: string, mediaId: string, part: number) {
  return doc(db, place, 'media', part === 1 ? mediaId : `${mediaId}_${part}`)
}

// Adds a photo or voice note to a batch of writes, cut into parts if needed. Returns its id.
// expireAt: it's in a disappearing message, so it goes when the message does.
// onceIn: it's "view once", in this message (once.ts). The rules then stop people loading it after they open it.
export function saveMedia(batch: WriteBatch, chatRef: DocumentReference, data: string, senderId: string, expireAt?: Timestamp, onceIn?: string) {
  return saveParts(batch, chatRef, data, { senderId, ...(expireAt ? { expireAt } : {}), ...(onceIn ? { onceIn } : {}) })
}

// The same, for anything: `fields` go in every part (who it belongs to, so the rules can check).
export function saveParts(batch: WriteBatch, parent: DocumentReference, data: string, fields: Record<string, unknown>) {
  const mediaId = doc(collection(parent, 'media')).id // a new random id
  const parts = Math.ceil(data.length / MAX_MEDIA)
  for (let part = 1; part <= parts; part++) {
    const piece = data.slice((part - 1) * MAX_MEDIA, part * MAX_MEDIA)
    const partFields: Record<string, unknown> = { data: piece, ...fields }
    if (part === 1 && parts > 1) partFields.parts = parts
    batch.set(partRef(parent.path, mediaId, part), partFields)
  }
  loaded.set(mediaId, data) // so YOUR bubble shows it straight away
  return mediaId
}

// Adds deleting a photo or voice note (all its parts) to a batch of writes.
export function deleteMedia(batch: WriteBatch, chatId: string, mediaId: string) {
  return deleteParts(batch, `chats/${chatId}`, mediaId)
}
export async function deleteParts(batch: WriteBatch, place: string, mediaId: string) {
  const known = loaded.get(mediaId)
  const parts = known ? Math.ceil(known.length / MAX_MEDIA) : (((await getDoc(partRef(place, mediaId, 1))).get('parts') as number) ?? 1)
  for (let part = 1; part <= parts; part++) batch.delete(partRef(place, mediaId, part))
  loaded.delete(mediaId)
}

export function loadMedia(chatId: string, mediaId: string) {
  return loadParts(`chats/${chatId}`, mediaId)
}
export async function loadParts(place: string, mediaId: string) {
  const known = loaded.get(mediaId)
  if (known) return known
  const first = await getDoc(partRef(place, mediaId, 1))
  let data = first.get('data') as string
  const parts = (first.get('parts') as number) ?? 1
  if (parts > 1) {
    const rest = await Promise.all(Array.from({ length: parts - 1 }, (_, i) => getDoc(partRef(place, mediaId, i + 2))))
    data += rest.map((snap) => snap.get('data') as string).join('')
  }
  if (data) data = mendType(data) // (no data: it's been deleted)
  loaded.set(mediaId, data)
  return data
}

// A video or document as a "blob URL" (blob:...), which plays and downloads much better than
// a long data URL. Made once for each file.
const blobUrls = new Map<string, string>()
const blobTypes = new Map<string, string>() // blob URL -> what kind of file it is ("video/mp4")

// Forget a file we loaded (a "view once" photo, after it's been seen), so it can't be shown again.
export function forgetMedia(mediaId: string) {
  loaded.delete(mediaId)
  const url = blobUrls.get(mediaId)
  if (url) URL.revokeObjectURL(url)
  blobUrls.delete(mediaId)
}
export function loadMediaUrl(chatId: string, mediaId: string) {
  return loadPartsUrl(`chats/${chatId}`, mediaId)
}
export async function loadPartsUrl(place: string, mediaId: string) {
  const known = blobUrls.get(mediaId)
  if (known) return known
  const data = await loadParts(place, mediaId)
  const blob = await (await fetch(data)).blob()
  const url = URL.createObjectURL(blob)
  blobUrls.set(mediaId, url)
  blobTypes.set(url, blob.type)
  return url
}

// The end of the file name for a video we loaded: "webm" or "mp4". (For Download.)
export function videoExtension(url: string) {
  return blobTypes.get(url)?.includes('webm') ? 'webm' : 'mp4'
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
