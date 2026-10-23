// What travels inside a locked message. Only the two phones can read it; the
// server sees none of this. It's JSON text, checked carefully when it arrives,
// because it comes from someone else's phone and could be anything.

/** A message in a chat, named by who wrote it and the id their phone gave it. */
export type Ref = { author: string; id: string };

/**
 * A file inside a message. The file itself was locked on the sender's phone
 * with `key` (only ever sent inside this locked message) and uploaded; the
 * server only has the locked bytes, under `id`. `digest` (SHA-256 of the
 * locked bytes) lets the other phone check nothing was changed.
 */
export type Attachment = {
  /** The server's id for the locked bytes. "pending" while the sender is still uploading. */
  id: string;
  /** 64 random bytes, base64: 32 to lock (AES-256), 32 to check (HMAC-SHA256). */
  key: string;
  digest: string;
  /** The size before locking, in bytes. */
  size: number;
  mime: string;
  kind: FileKind;
  /** The file's own name (documents). */
  name?: string;
  width?: number;
  height?: number;
  /** Videos and voice notes, in ms. */
  duration?: number;
  /** A tiny blurred preview (JPEG, base64), shown before the photo or video downloads. */
  thumb?: string;
  /** Voice notes: how loud each moment was, one byte (0 to 255) each, base64. Drawn as bars. */
  waveform?: string;
  /** A GIF: a short silent video that plays on a loop. */
  gif?: true;
};

/** `sticker`: a picture with a see-through background, shown big and without a bubble. */
export type FileKind = 'image' | 'video' | 'audio' | 'voice' | 'doc' | 'sticker';
export const FILE_KINDS: readonly FileKind[] = ['image', 'video', 'audio', 'voice', 'doc', 'sticker'];

/**
 * A reply to someone's status carries a little copy of it (the status itself
 * is gone after a day, and the chat isn't the status's).
 */
export type StatusQuote = { author: string; id: string; kind: 'text' | 'image' | 'video'; text?: string; thumb?: string };

/**
 * A call message: never shown as a bubble, never saved. One call (`call`, its
 * id) is a few of these between the phones in it:
 *   ring     a call starts: phones ring (to everyone in the chat)
 *   join     I'm in the call now (answering is joining)
 *   here     "I'm already in it", the answer to a join, so the two connect
 *   offer, answer, ice   WebRTC connecting two phones (to one device)
 *   leave    I hung up
 *   decline  I said no (or "answered on another of my devices")
 *   busy     I'm on another call
 *   media    my microphone or camera went on or off
 * The device with the smaller name ("user:device") makes the offer, so two
 * phones never both start (see app/src/calls).
 */
export type CallOp = 'ring' | 'join' | 'here' | 'offer' | 'answer' | 'ice' | 'leave' | 'decline' | 'busy' | 'media';
export const CALL_OPS: readonly CallOp[] = ['ring', 'join', 'here', 'offer', 'answer', 'ice', 'leave', 'decline', 'busy', 'media'];
export type IceCandidate = { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null };
export type CallSignal = {
  t: 'call';
  call: string;
  op: CallOp;
  /** ring: a video call. media: my camera is on. */
  video?: boolean;
  /** media: my microphone is on. */
  audio?: boolean;
  /** ring: a group call. */
  group?: boolean;
  sdp?: string;
  cand?: IceCandidate;
};

/** Things that show up as a message bubble. */
export type Body =
  /** `bg`: a status in words, on one of the app's colours. `status`: a reply to someone's status. */
  | { t: 'text'; text: string; mentions?: string[]; replyTo?: Ref; forwarded?: boolean; bg?: number; status?: StatusQuote }
  | { t: 'poll'; question: string; options: string[]; multi: boolean }
  | { t: 'file'; file: Attachment; caption?: string; mentions?: string[]; replyTo?: Ref; forwarded?: boolean; status?: StatusQuote };

/** Changes to messages that are already there. */
export type Change =
  /** New words for my own message (within 15 minutes). */
  | { t: 'edit'; target: string; text: string; mentions?: string[] }
  /** Delete my own message for everyone (within 60 hours), or anyone's if I'm a group admin. */
  | { t: 'delete'; target: Ref }
  /** My reaction, or null to take it back. */
  | { t: 'react'; target: Ref; emoji: string | null }
  /** My answers to a poll (option numbers). An empty list takes my vote back. */
  | { t: 'vote'; target: Ref; options: number[] }
  /** Pin a message until a time (ms), or null to unpin. */
  | { t: 'pin'; target: Ref; until: number | null }
  /** Disappearing messages: how long messages last, in seconds. 0 turns it off. */
  | { t: 'timer'; seconds: number };

/** The app's own housekeeping, never shown. */
export type Control =
  /** My group key for one group, sent locked to each device that needs it. */
  | { t: 'key'; distributionId: string; key: string }
  /** "I couldn't open your message number `seq`, please send it again." Sent unlocked. */
  | { t: 'retry'; seq: number; why: 'session' | 'groupKey' }
  | CallSignal;

export type Payload = Body | Change | Control;

/**
 * One locked message's inside.
 *   v:    the format version, so older apps can tell when something is newer.
 *   id:   made by the sender's phone. The same id twice is the same message.
 *   chat: the chat it belongs to, so the server can't move it into another chat.
 *   at:   the sender's clock (ms). The server's time is used for rules.
 */
export type Content = Payload & { v: 1; id: string; chat: string; at: number };

export const BODY_TYPES = ['text', 'poll', 'file'] as const;
export const CHANGE_TYPES = ['edit', 'delete', 'react', 'vote', 'pin', 'timer'] as const;

// Limits, so nobody can send something huge or odd.
const MAX_TEXT = 20_000;
const MAX_OPTIONS = 12;
const MAX_MENTIONS = 256;
const MAX_ID = 64;
const MAX_THUMB = 16_000;
const MAX_SDP = 20_000;
/** How many colours a status in words can have (the app has a list). */
export const STATUS_COLOURS = 12;

export function isBody(c: Payload): c is Body {
  return (BODY_TYPES as readonly string[]).includes(c.t);
}

export function isChange(c: Payload): c is Change {
  return (CHANGE_TYPES as readonly string[]).includes(c.t);
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isId = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= MAX_ID;
const isText = (x: unknown, max = MAX_TEXT): x is string => typeof x === 'string' && x.length <= max;
const isRef = (x: unknown): x is Ref => isObject(x) && isId(x.author) && isId(x.id);
const isIdList = (x: unknown, max: number): x is string[] => Array.isArray(x) && x.length <= max && x.every(isId);
const isCount = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 0;

/** Checks a file's description. Returns it with only the known fields, or null. */
function checkAttachment(x: unknown): Attachment | null {
  if (!isObject(x) || !isId(x.id) || !isText(x.key, 200) || !isText(x.digest, 200)) return null;
  if (!isCount(x.size) || !isText(x.mime, 200) || !FILE_KINDS.includes(x.kind as FileKind)) return null;
  const out: Attachment = { id: x.id, key: x.key, digest: x.digest, size: x.size, mime: x.mime, kind: x.kind as FileKind };
  if (x.name !== undefined) {
    if (!isText(x.name, 255)) return null;
    out.name = x.name;
  }
  for (const k of ['width', 'height', 'duration'] as const) {
    if (x[k] === undefined) continue;
    if (!isCount(x[k])) return null;
    out[k] = x[k];
  }
  if (x.thumb !== undefined) {
    if (!isText(x.thumb, MAX_THUMB)) return null;
    out.thumb = x.thumb;
  }
  if (x.waveform !== undefined) {
    if (!isText(x.waveform, 400) || !/^[A-Za-z0-9+/]*={0,2}$/.test(x.waveform)) return null;
    out.waveform = x.waveform;
  }
  if (x.gif === true) out.gif = true;
  return out;
}

function checkQuote(x: unknown): StatusQuote | null {
  if (!isObject(x) || !isId(x.author) || !isId(x.id) || !['text', 'image', 'video'].includes(x.kind as string)) return null;
  const out: StatusQuote = { author: x.author, id: x.id, kind: x.kind as StatusQuote['kind'] };
  if (x.text !== undefined) {
    if (!isText(x.text, 700)) return null;
    out.text = x.text;
  }
  if (x.thumb !== undefined) {
    if (!isText(x.thumb, MAX_THUMB)) return null;
    out.thumb = x.thumb;
  }
  return out;
}

function checkCall(x: Record<string, unknown>): CallSignal | null {
  if (!isId(x.call) || !CALL_OPS.includes(x.op as CallOp)) return null;
  const out: CallSignal = { t: 'call', call: x.call, op: x.op as CallOp };
  for (const k of ['video', 'audio', 'group'] as const) if (typeof x[k] === 'boolean') out[k] = x[k];
  if (x.sdp !== undefined) {
    if (!isText(x.sdp, MAX_SDP)) return null;
    out.sdp = x.sdp;
  }
  if (x.cand !== undefined) {
    const c = x.cand;
    if (!isObject(c) || !isText(c.candidate, 1000)) return null;
    out.cand = { candidate: c.candidate };
    if (c.sdpMid === null || isText(c.sdpMid, 64)) out.cand.sdpMid = c.sdpMid as string | null;
    if (c.sdpMLineIndex === null || isCount(c.sdpMLineIndex)) out.cand.sdpMLineIndex = c.sdpMLineIndex as number | null;
  }
  return out;
}

/** Checks one payload's shape. Returns it with only the known fields, or null. */
function checkPayload(x: Record<string, unknown>): Payload | null {
  switch (x.t) {
    case 'text': {
      if (!isText(x.text) || x.text.trim() === '') return null;
      if (x.mentions !== undefined && !isIdList(x.mentions, MAX_MENTIONS)) return null;
      if (x.replyTo !== undefined && !isRef(x.replyTo)) return null;
      const out: Body = { t: 'text', text: x.text };
      if (x.mentions) out.mentions = x.mentions as string[];
      if (x.replyTo) out.replyTo = { author: (x.replyTo as Ref).author, id: (x.replyTo as Ref).id };
      if (x.forwarded === true) out.forwarded = true;
      if (x.bg !== undefined) {
        if (!isCount(x.bg) || x.bg >= STATUS_COLOURS) return null;
        out.bg = x.bg;
      }
      if (x.status !== undefined) {
        const quote = checkQuote(x.status);
        if (!quote) return null;
        out.status = quote;
      }
      return out;
    }
    case 'poll': {
      if (!isText(x.question, 300) || x.question.trim() === '') return null;
      const options = x.options;
      if (!Array.isArray(options) || options.length < 2 || options.length > MAX_OPTIONS) return null;
      if (!options.every((o) => isText(o, 100) && o.trim() !== '')) return null;
      return { t: 'poll', question: x.question, options: options as string[], multi: x.multi === true };
    }
    case 'file': {
      const file = checkAttachment(x.file);
      if (!file) return null;
      if (x.caption !== undefined && !isText(x.caption)) return null;
      if (x.mentions !== undefined && !isIdList(x.mentions, MAX_MENTIONS)) return null;
      if (x.replyTo !== undefined && !isRef(x.replyTo)) return null;
      const out: Body = { t: 'file', file };
      if (typeof x.caption === 'string' && x.caption.trim()) out.caption = x.caption;
      if (x.mentions) out.mentions = x.mentions as string[];
      if (x.replyTo) out.replyTo = { author: (x.replyTo as Ref).author, id: (x.replyTo as Ref).id };
      if (x.forwarded === true) out.forwarded = true;
      if (x.status !== undefined) {
        const quote = checkQuote(x.status);
        if (!quote) return null;
        out.status = quote;
      }
      return out;
    }
    case 'edit':
      if (!isId(x.target) || !isText(x.text) || x.text.trim() === '') return null;
      if (x.mentions !== undefined && !isIdList(x.mentions, MAX_MENTIONS)) return null;
      return x.mentions ? { t: 'edit', target: x.target, text: x.text, mentions: x.mentions as string[] } : { t: 'edit', target: x.target, text: x.text };
    case 'delete':
      return isRef(x.target) ? { t: 'delete', target: { author: x.target.author, id: x.target.id } } : null;
    case 'react':
      if (!isRef(x.target)) return null;
      if (x.emoji !== null && !(isText(x.emoji, 32) && x.emoji !== '')) return null;
      return { t: 'react', target: { author: x.target.author, id: x.target.id }, emoji: x.emoji as string | null };
    case 'vote':
      if (!isRef(x.target) || !Array.isArray(x.options) || x.options.length > MAX_OPTIONS) return null;
      if (!x.options.every((o) => isCount(o) && o < MAX_OPTIONS)) return null;
      return { t: 'vote', target: { author: x.target.author, id: x.target.id }, options: [...new Set(x.options as number[])].sort((a, b) => a - b) };
    case 'pin':
      if (!isRef(x.target) || !(x.until === null || isCount(x.until))) return null;
      return { t: 'pin', target: { author: x.target.author, id: x.target.id }, until: x.until as number | null };
    case 'timer':
      return isCount(x.seconds) && x.seconds <= 366 * 24 * 3600 ? { t: 'timer', seconds: x.seconds } : null;
    case 'key':
      return isId(x.distributionId) && isText(x.key, 4096) ? { t: 'key', distributionId: x.distributionId, key: x.key } : null;
    case 'retry':
      return isCount(x.seq) && (x.why === 'session' || x.why === 'groupKey') ? { t: 'retry', seq: x.seq, why: x.why } : null;
    case 'call':
      return checkCall(x);
    default:
      return null;
  }
}

/** Reads a message's inside. Anything that isn't exactly right gives null. */
export function parseContent(text: string): Content | null {
  let x: unknown;
  try {
    x = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(x) || x.v !== 1 || !isId(x.id) || !isId(x.chat) || !isCount(x.at)) return null;
  const payload = checkPayload(x);
  return payload && { ...payload, v: 1, id: x.id, chat: x.chat, at: x.at };
}

export function writeContent(c: Content): string {
  return JSON.stringify(c);
}
