// photoEdit.ts: the sums behind the photo editor (PhotoEditor.tsx is what you see).
//
// An edit is a short list of changes, not a new picture: how many times it was turned,
// which part is kept (the crop), the lines you drew and the words you wrote.
// So Undo is easy (go back to the list before), and the photo is only drawn for real once,
// at full size, when you press Done.
//
// Every position is a fraction of the (turned) photo: x = 0 is its left edge, 1 its right edge.
// Then the same edit fits the small picture on screen and the big one that's sent.
import { HD_SIDE } from './media'

export type Point = [number, number]
export type Rect = { x: number; y: number; w: number; h: number }
// size: a fraction of the photo's shorter side, so a line looks the same on any size of photo.
export type Stroke = { colour: string; size: number; points: Point[] }
// turns: how many times the photo was turned after the words were written (they turn with it).
export type Label = { id: number; text: string; colour: string; x: number; y: number; size: number; turns: number }
export type Edit = { turns: number; crop: Rect; strokes: Stroke[]; labels: Label[] }

export const WHOLE: Rect = { x: 0, y: 0, w: 1, h: 1 }
export const FRESH: Edit = { turns: 0, crop: WHOLE, strokes: [], labels: [] }
export const COLOURS = ['#ffffff', '#000000', '#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa']
export const PEN = 0.012 // how thick a line is
export const TEXT = 0.08 // how big words are
const SMALLEST = 0.1 // a crop can't be smaller than a tenth of the photo

export const isFresh = (e: Edit) => e.turns === 0 && e.strokes.length === 0 && e.labels.length === 0 && e.crop.w === 1 && e.crop.h === 1

// The photo's width and height after turning it (a quarter turn swaps them).
export const turnedSize = (width: number, height: number, turns: number): [number, number] => (turns % 2 ? [height, width] : [width, height])

// Turning the photo a quarter turn to the left: the top edge becomes the left edge,
// so a spot at (x, y) moves to (y, 1 - x). Everything on it moves the same way.
const turnPoint = ([x, y]: Point): Point => [y, 1 - x]
export function turnLeft(e: Edit): Edit {
  return {
    turns: (e.turns + 1) % 4,
    crop: { x: e.crop.y, y: 1 - e.crop.x - e.crop.w, w: e.crop.h, h: e.crop.w },
    strokes: e.strokes.map((s) => ({ ...s, points: s.points.map(turnPoint) })),
    labels: e.labels.map((l) => {
      const [x, y] = turnPoint([l.x, l.y])
      return { ...l, x, y, turns: (l.turns + 1) % 4 }
    }),
  }
}

// Change the crop by dragging one of its corners ('nw', 'ne', 'sw', 'se') or the middle ('move').
// dx, dy: how far the finger moved, as fractions of the photo.
export type Handle = 'nw' | 'ne' | 'sw' | 'se' | 'move'
export function dragCrop(r: Rect, handle: Handle, dx: number, dy: number): Rect {
  const clamp = (v: number, low: number, high: number) => Math.min(high, Math.max(low, v))
  if (handle === 'move') return { ...r, x: clamp(r.x + dx, 0, 1 - r.w), y: clamp(r.y + dy, 0, 1 - r.h) }
  let { x, y } = r
  let right = r.x + r.w
  let bottom = r.y + r.h
  if (handle === 'nw' || handle === 'sw') x = clamp(x + dx, 0, right - SMALLEST)
  if (handle === 'ne' || handle === 'se') right = clamp(right + dx, x + SMALLEST, 1)
  if (handle === 'nw' || handle === 'ne') y = clamp(y + dy, 0, bottom - SMALLEST)
  if (handle === 'sw' || handle === 'se') bottom = clamp(bottom + dy, y + SMALLEST, 1)
  return { x, y, w: right - x, h: bottom - y }
}

type Picture = CanvasImageSource & { width: number; height: number }

// Draw the photo with its edit onto a canvas that's outW × outH pixels.
// cropped = false draws the whole turned photo (while you're choosing the crop).
export function drawEdit(ctx: CanvasRenderingContext2D, image: Picture, e: Edit, outW: number, outH: number, cropped = true) {
  const [tw, th] = turnedSize(image.width, image.height, e.turns)
  const crop = cropped ? e.crop : WHOLE
  ctx.save()
  ctx.clearRect(0, 0, outW, outH)
  ctx.scale(outW / (crop.w * tw), outH / (crop.h * th))
  ctx.translate(-crop.x * tw, -crop.y * th)

  // The photo, turned. (Canvas turns go clockwise, so a left turn is a negative angle.)
  ctx.save()
  if (e.turns === 1) ctx.translate(0, th)
  if (e.turns === 2) ctx.translate(tw, th)
  if (e.turns === 3) ctx.translate(tw, 0)
  ctx.rotate((-e.turns * Math.PI) / 2)
  ctx.drawImage(image, 0, 0)
  ctx.restore()

  const unit = Math.min(tw, th)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const s of e.strokes) {
    ctx.strokeStyle = s.colour
    ctx.lineWidth = s.size * unit
    ctx.beginPath()
    s.points.forEach(([x, y], i) => (i ? ctx.lineTo(x * tw, y * th) : ctx.moveTo(x * tw, y * th)))
    if (s.points.length === 1) ctx.lineTo(s.points[0][0] * tw + 0.01, s.points[0][1] * th) // (a tap draws a dot)
    ctx.stroke()
  }
  for (const l of e.labels) drawLabel(ctx, l, tw, th, unit)
  ctx.restore()
}

function drawLabel(ctx: CanvasRenderingContext2D, l: Label, tw: number, th: number, unit: number) {
  const size = l.size * unit
  const lines = l.text.split('\n')
  ctx.save()
  ctx.translate(l.x * tw, l.y * th)
  ctx.rotate((-l.turns * Math.PI) / 2)
  ctx.font = `bold ${size}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = l.colour
  // A soft shadow, so white words still show on a white wall.
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)'
  ctx.shadowBlur = size * 0.12
  lines.forEach((line, i) => ctx.fillText(line, 0, (i - (lines.length - 1) / 2) * size * 1.2))
  ctx.restore()
}

// Where some words are, as a box (fractions of the turned photo), so a tap can pick them up.
export function labelBox(ctx: CanvasRenderingContext2D, l: Label, tw: number, th: number): Rect {
  const size = l.size * Math.min(tw, th)
  ctx.save()
  ctx.font = `bold ${size}px system-ui, sans-serif`
  const width = Math.max(...l.text.split('\n').map((line) => ctx.measureText(line).width)) + size * 0.4
  ctx.restore()
  const height = l.text.split('\n').length * size * 1.2 + size * 0.2
  const [w, h] = l.turns % 2 ? [height, width] : [width, height]
  return { x: l.x - w / tw / 2, y: l.y - h / th / 2, w: w / tw, h: h / th }
}

// Open a photo for editing: no bigger than HD needs (smaller is faster to draw while you edit).
export async function loadForEditing(file: Blob) {
  const image = await createImageBitmap(file)
  const scale = Math.min(1, HD_SIDE / Math.max(image.width, image.height))
  if (scale === 1) return image
  const smaller = await createImageBitmap(image, { resizeWidth: Math.round(image.width * scale), resizeHeight: Math.round(image.height * scale), resizeQuality: 'high' })
  image.close()
  return smaller
}

// The finished photo, at full size, as a JPEG file (PhotoSender.tsx then sends it like any photo).
export function renderEdit(image: Picture, e: Edit) {
  const [tw, th] = turnedSize(image.width, image.height, e.turns)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(e.crop.w * tw))
  canvas.height = Math.max(1, Math.round(e.crop.h * th))
  drawEdit(canvas.getContext('2d')!, image, e, canvas.width, canvas.height)
  return new Promise<File>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(new File([blob], 'photo.jpg', { type: 'image/jpeg' })) : reject(new Error('cant-save'))), 'image/jpeg', 0.92),
  )
}
