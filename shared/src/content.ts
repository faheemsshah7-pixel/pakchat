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
};

export type FileKind = 'image' | 'video' | 'audio' | 'voice' | 'doc';
export const FILE_KINDS: readonly FileKind[] = ['image', 'video', 'audio', 'voice', 'doc'];

/** Things that show up as a message bubble. */
export type Body =
  | { t: 'text'; text: string; mentions?: string[]; replyTo?: Ref; forwarded?: boolean }
  | { t: 'poll'; question: string; options: string[]; multi: boolean }
  | { t: 'file'; file: Attachment; caption?: string; mentions?: string[]; replyTo?: Ref; forwarded?: boolean };

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
  | { t: 'retry'; seq: number; why: 'session' | 'groupKey' };

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
