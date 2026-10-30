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
  /** View once: a photo, video or voice note that can be opened one time, then it's gone. */
  once?: true;
  /** A round video message (recorded in the chat, shown in a circle). */
  round?: true;
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
 * "Reply privately" to a group message: a little copy of it goes with the
 * reply in the one-to-one chat (the other person may not have the group open).
 */
export type ChatQuote = { chat: string; author: string; id: string; kind: 'text' | 'image' | 'video' | 'voice' | 'file' | 'poll' | 'other'; text?: string; thumb?: string };

/** A web page named in a message, made into a card on the sender's phone (so the receiver's phone never visits it). */
export type LinkPreview = { url: string; title?: string; description?: string; site?: string; thumb?: string };

/** Someone's details, as a contact card. `user`: their PakChat id, if they're on PakChat. */
export type SharedContact = { name: string; phones: string[]; emails?: string[]; user?: string };

/** A place. `live`: sharing where I am until this time (ms); the moves come as `live` changes. */
export type Place = { lat: number; lng: number; name?: string; address?: string; live?: number };

/**
 * A call planned for later, with an optional call link. Or (`general`) an event
 * from the 📎, like WhatsApp's: a name, when it starts (and `end`s), where
 * (`place`), and a call only when `call` says so. People answer Going (vote 0)
 * or Not going (vote 1) with a `vote` change, as on a poll.
 */
export type CallPlan = { title: string; at: number; video: boolean; link?: string; about?: string; end?: number; place?: string; general?: true; call?: true };

/**
 * A call message: never shown as a bubble, never saved. One call (`call`, its
 * id) is a few of these between the phones in it:
 *   ring     a call starts: phones ring (to everyone in the chat)
 *   join     I'm in the call now (answering is joining)
 *   here     "I'm already in it", the answer to a join, so the two connect
 *   offer, answer, ice   WebRTC connecting two phones (to one device)
 *   ringing  my phone is ringing now (the caller's screen goes from "Calling…" to "Ringing…")
 *   leave    I hung up
 *   decline  I said no (or "answered on another of my devices")
 *   busy     I'm on another call
 *   media    my microphone or camera went on or off
 * The device with the smaller name ("user:device") makes the offer, so two
 * phones never both start (see app/src/calls).
 */
export type CallOp = 'ring' | 'ringing' | 'join' | 'here' | 'offer' | 'answer' | 'ice' | 'leave' | 'decline' | 'busy' | 'media';
export const CALL_OPS: readonly CallOp[] = ['ring', 'ringing', 'join', 'here', 'offer', 'answer', 'ice', 'leave', 'decline', 'busy', 'media'];
export type IceCandidate = { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null };
export type CallSignal = {
  t: 'call';
  call: string;
  op: CallOp;
  /** ring: a video call. media: my camera is on. */
  video?: boolean;
  /** media: my microphone is on. */
  audio?: boolean;
  /** media: what I send is my screen (shown whole, not cropped), not my camera. */
  screen?: boolean;
  /** ring: a group call. */
  group?: boolean;
  /**
   * ring, when someone is added to a call that isn't a group chat's: who else
   * is in it (user ids), so the new person's phone can connect to them too.
   */
  people?: string[];
  /**
   * ringing: this phone can connect while it rings (owner, 25 Oct), so the
   * caller's phone may start connecting now. Nothing is sent either way
   * (no sound, no picture) until the call is answered. Older phones leave it out.
   */
  early?: boolean;
  sdp?: string;
  cand?: IceCandidate;
};
/** A call has room for this many people (each phone sends to every other). */
export const MAX_CALL_PEOPLE = 8;

/** Things that show up as a message bubble. */
export type Body =
  /** `bg`: a status in words, on one of the app's colours. `status`: a reply to someone's status. */
  | { t: 'text'; text: string; mentions?: string[]; replyTo?: Ref; forwarded?: boolean; hops?: number; bg?: number; status?: StatusQuote; quote?: ChatQuote; link?: LinkPreview }
  | { t: 'poll'; question: string; options: string[]; multi: boolean }
  | { t: 'file'; file: Attachment; caption?: string; mentions?: string[]; replyTo?: Ref; forwarded?: boolean; hops?: number; status?: StatusQuote; quote?: ChatQuote }
  | ({ t: 'location'; replyTo?: Ref; forwarded?: boolean; hops?: number } & Place)
  | { t: 'contact'; cards: SharedContact[]; replyTo?: Ref; forwarded?: boolean; hops?: number }
  // The event's time is `when` here: `at` is the message's own time.
  | ({ t: 'event'; when: number } & Omit<CallPlan, 'at'>);

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
  | { t: 'timer'; seconds: number }
  /** Keep in chat: a disappearing message stays (or, `keep: false`, goes again), like WhatsApp's. */
  | { t: 'keep'; target: Ref; keep: boolean }
  /** I opened a view once message (so it's gone on my other devices, and the sender sees "Opened"). */
  | { t: 'opened'; target: Ref }
  /** My live location moved, or (`stop`) I stopped sharing it. */
  | { t: 'live'; target: Ref; lat: number; lng: number; stop?: true };

/** The app's own housekeeping, never shown. */
export type Control =
  /** My group key for one group, sent locked to each device that needs it. */
  | { t: 'key'; distributionId: string; key: string }
  /** "I couldn't open your message number `seq`, please send it again." Sent unlocked. */
  | { t: 'retry'; seq: number; why: 'session' | 'groupKey' }
  /** My phone to a website it just linked: one part of its chat history (see history.ts). */
  | { t: 'history'; part: number; last: boolean; file: HistoryFile }
  /** A chat setting changed on one of my devices: my other devices do the same (see SyncChange). */
  | ({ t: 'sync' } & SyncChange)
  | CallSignal;

/**
 * What my own devices keep the same, both ways, like WhatsApp's: archive,
 * pin, mute, favourites, lists, starred messages, saved contacts and chat
 * lock. Sent locked to my other devices only (the server never sees it).
 *   key:  which list, e.g. "app:prefs" (by chat), "app:starred" (by message).
 *   set:  entries that are new or changed, whole.
 *   del:  entries that are gone.
 *   value: lists kept whole ("app:lists"), or the secret code's check ("app:lockCode").
 */
export type SyncChange = { key: SyncKey; set?: Record<string, unknown>; del?: string[]; value?: unknown };
export const SYNC_KEYS = ['app:prefs', 'app:starred', 'app:contacts', 'app:lists', 'app:lockCode'] as const;
export type SyncKey = (typeof SYNC_KEYS)[number];
/** The chat settings that go to my other devices (drafts, tones and wallpapers stay on each). */
export const SYNCED_PREFS = ['pinnedAt', 'archived', 'muted', 'mutedUntil', 'favourite', 'markedUnread', 'lock', 'deletedAt'] as const;
const MAX_SYNC_ENTRIES = 5000;
const MAX_SYNC_BYTES = 256_000;

/** A locked history part on the server: where it is, its key and digest, and its size before locking. */
export type HistoryFile = { id: string; key: string; digest: string; size: number };

export type Payload = Body | Change | Control;

/**
 * One locked message's inside.
 *   v:    the format version, so older apps can tell when something is newer.
 *   id:   made by the sender's phone. The same id twice is the same message.
 *   chat: the chat it belongs to, so the server can't move it into another chat.
 *   at:   the sender's clock (ms). The server's time is used for rules.
 */
export type Content = Payload & { v: 1; id: string; chat: string; at: number };

export const BODY_TYPES = ['text', 'poll', 'file', 'location', 'contact', 'event'] as const;
export const CHANGE_TYPES = ['edit', 'delete', 'react', 'vote', 'pin', 'keep', 'timer', 'opened', 'live'] as const;
/** Live location: for 15 minutes, 1 hour or 8 hours, as on WhatsApp. */
export const LIVE_MAX_MS = 8 * 3600_000;

// Limits, so nobody can send something huge or odd.
const MAX_TEXT = 20_000;
/** How many times a message was forwarded, counted up to this. */
const MAX_HOPS = 1000;
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
  // View once only for photos, videos and voice notes.
  if (x.once === true && (out.kind === 'image' || out.kind === 'video' || out.kind === 'voice')) out.once = true;
  if (x.round === true && out.kind === 'video') out.round = true;
  return out;
}

const QUOTE_KINDS = ['text', 'image', 'video', 'voice', 'file', 'poll', 'other'];

function checkChatQuote(x: unknown): ChatQuote | null {
  if (!isObject(x) || !isId(x.chat) || !isId(x.author) || !isId(x.id) || !QUOTE_KINDS.includes(x.kind as string)) return null;
  const out: ChatQuote = { chat: x.chat, author: x.author, id: x.id, kind: x.kind as ChatQuote['kind'] };
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

function checkLink(x: unknown): LinkPreview | null {
  if (!isObject(x) || !isText(x.url, 2000) || !/^https?:\/\//i.test(x.url)) return null;
  const out: LinkPreview = { url: x.url };
  for (const [k, max] of [['title', 300], ['description', 500], ['site', 100]] as const) {
    if (x[k] === undefined) continue;
    if (!isText(x[k], max)) return null;
    out[k] = x[k];
  }
  if (x.thumb !== undefined) {
    if (!isText(x.thumb, MAX_THUMB)) return null;
    out.thumb = x.thumb;
  }
  return out;
}

const isLat = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= -90 && x <= 90;
const isLng = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= -180 && x <= 180;

function checkCard(x: unknown): SharedContact | null {
  if (!isObject(x) || !isText(x.name, 200) || x.name.trim() === '') return null;
  if (!Array.isArray(x.phones) || x.phones.length > 10 || !x.phones.every((p) => isText(p, 40) && p.trim() !== '')) return null;
  const out: SharedContact = { name: x.name, phones: x.phones as string[] };
  if (x.emails !== undefined) {
    if (!Array.isArray(x.emails) || x.emails.length > 10 || !x.emails.every((e) => isText(e, 200) && e.trim() !== '')) return null;
    out.emails = x.emails as string[];
  }
  if (x.user !== undefined) {
    if (!isId(x.user)) return null;
    out.user = x.user;
  }
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
  for (const k of ['video', 'audio', 'group', 'screen', 'early'] as const) if (typeof x[k] === 'boolean') out[k] = x[k];
  if (x.people !== undefined) {
    if (!isIdList(x.people, MAX_CALL_PEOPLE)) return null;
    out.people = [...new Set(x.people)];
  }
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
      if (x.forwarded === true && isCount(x.hops) && x.hops > 1) out.hops = Math.min(x.hops, MAX_HOPS);
      if (x.bg !== undefined) {
        if (!isCount(x.bg) || x.bg >= STATUS_COLOURS) return null;
        out.bg = x.bg;
      }
      if (x.status !== undefined) {
        const quote = checkQuote(x.status);
        if (!quote) return null;
        out.status = quote;
      }
      if (x.quote !== undefined) {
        const quote = checkChatQuote(x.quote);
        if (!quote) return null;
        out.quote = quote;
      }
      if (x.link !== undefined) {
        // A broken card isn't worth losing the words for.
        const link = checkLink(x.link);
        if (link) out.link = link;
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
      if (x.forwarded === true && isCount(x.hops) && x.hops > 1) out.hops = Math.min(x.hops, MAX_HOPS);
      if (x.status !== undefined) {
        const quote = checkQuote(x.status);
        if (!quote) return null;
        out.status = quote;
      }
      if (x.quote !== undefined) {
        const quote = checkChatQuote(x.quote);
        if (!quote) return null;
        out.quote = quote;
      }
      return out;
    }
    case 'location': {
      if (!isLat(x.lat) || !isLng(x.lng)) return null;
      if (x.replyTo !== undefined && !isRef(x.replyTo)) return null;
      const out: Body = { t: 'location', lat: x.lat, lng: x.lng };
      if (x.name !== undefined) {
        if (!isText(x.name, 200)) return null;
        out.name = x.name;
      }
      if (x.address !== undefined) {
        if (!isText(x.address, 400)) return null;
        out.address = x.address;
      }
      if (x.live !== undefined) {
        if (!isCount(x.live)) return null;
        out.live = x.live;
      }
      if (x.replyTo) out.replyTo = { author: (x.replyTo as Ref).author, id: (x.replyTo as Ref).id };
      if (x.forwarded === true) out.forwarded = true;
      if (x.forwarded === true && isCount(x.hops) && x.hops > 1) out.hops = Math.min(x.hops, MAX_HOPS);
      return out;
    }
    case 'contact': {
      if (!Array.isArray(x.cards) || x.cards.length < 1 || x.cards.length > 20) return null;
      const cards = x.cards.map(checkCard);
      if (cards.some((c) => !c)) return null;
      if (x.replyTo !== undefined && !isRef(x.replyTo)) return null;
      const out: Body = { t: 'contact', cards: cards as SharedContact[] };
      if (x.replyTo) out.replyTo = { author: (x.replyTo as Ref).author, id: (x.replyTo as Ref).id };
      if (x.forwarded === true) out.forwarded = true;
      if (x.forwarded === true && isCount(x.hops) && x.hops > 1) out.hops = Math.min(x.hops, MAX_HOPS);
      return out;
    }
    case 'event': {
      // The event's time is `when`. (Before 29 Oct it was only `at`, which the message's own time
      // overwrote; those old events show their send time, as they always did.)
      const when = x.when ?? x.at;
      if (!isText(x.title, 200) || x.title.trim() === '' || !isCount(when)) return null;
      const out: Body = { t: 'event', title: x.title, when, video: x.video === true };
      if (x.link !== undefined) {
        if (!isText(x.link, 64) || !/^[A-Za-z0-9_-]+$/.test(x.link)) return null;
        out.link = x.link;
      }
      if (x.about !== undefined) {
        if (!isText(x.about, 1000)) return null;
        out.about = x.about;
      }
      if (x.end !== undefined) {
        if (!isCount(x.end) || x.end < when) return null;
        out.end = x.end;
      }
      if (x.place !== undefined) {
        if (!isText(x.place, 300)) return null;
        out.place = x.place;
      }
      if (x.general === true) out.general = true;
      if (x.call === true) out.call = true;
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
    case 'keep':
      if (!isRef(x.target) || typeof x.keep !== 'boolean') return null;
      return { t: 'keep', target: { author: x.target.author, id: x.target.id }, keep: x.keep };
    case 'timer':
      return isCount(x.seconds) && x.seconds <= 366 * 24 * 3600 ? { t: 'timer', seconds: x.seconds } : null;
    case 'opened':
      return isRef(x.target) ? { t: 'opened', target: { author: x.target.author, id: x.target.id } } : null;
    case 'live': {
      if (!isRef(x.target) || !isLat(x.lat) || !isLng(x.lng)) return null;
      const out: Change = { t: 'live', target: { author: x.target.author, id: x.target.id }, lat: x.lat, lng: x.lng };
      if (x.stop === true) out.stop = true;
      return out;
    }
    case 'key':
      return isId(x.distributionId) && isText(x.key, 4096) ? { t: 'key', distributionId: x.distributionId, key: x.key } : null;
    case 'retry':
      return isCount(x.seq) && (x.why === 'session' || x.why === 'groupKey') ? { t: 'retry', seq: x.seq, why: x.why } : null;
    case 'history': {
      const f = x.file;
      if (!isCount(x.part) || x.part < 1 || x.part > 100 || typeof x.last !== 'boolean' || !isObject(f)) return null;
      if (!isId(f.id) || !isText(f.key, 200) || !isText(f.digest, 200) || !isCount(f.size)) return null;
      return { t: 'history', part: x.part, last: x.last, file: { id: f.id, key: f.key, digest: f.digest, size: f.size } };
    }
    case 'sync':
      return checkSync(x);
    case 'call':
      return checkCall(x);
    default:
      return null;
  }
}

function checkSync(x: Record<string, unknown>): Control | null {
  if (!SYNC_KEYS.includes(x.key as SyncKey)) return null;
  const out: Control = { t: 'sync', key: x.key as SyncKey };
  if (x.set !== undefined) {
    if (!isObject(x.set) || Object.keys(x.set).length > MAX_SYNC_ENTRIES || !Object.keys(x.set).every((k) => k.length > 0 && k.length <= 200)) return null;
    out.set = x.set;
  }
  if (x.del !== undefined) {
    if (!Array.isArray(x.del) || x.del.length > MAX_SYNC_ENTRIES || !x.del.every((k) => typeof k === 'string' && k.length > 0 && k.length <= 200)) return null;
    out.del = x.del as string[];
  }
  if (x.value !== undefined) out.value = x.value;
  if (JSON.stringify(out).length > MAX_SYNC_BYTES) return null;
  return out;
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
