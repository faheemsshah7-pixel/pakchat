// calls.ts: voice and video calls, one to one or a group of up to 8.
//
// The sound and video go straight from phone to phone (WebRTC), locked by
// WebRTC itself (DTLS-SRTP). Our server only passes the call messages that set
// it up, and those are locked with Signal like any message, so the server
// never sees who said what, only that two phones are talking.
//
// How a call goes (the messages are in shared/src/content.ts, CallSignal):
//   1. Ali taps call: Ali's phone sends "ring" to everyone in the chat. Phones
//      that are closed are woken by a push, and ring (CallAlerts.kt).
//   2. Sara answers: her phone sends "join" to everyone in the chat. Her other
//      phones stop ringing ("answered on another device").
//   3. Everyone already in the call answers Sara with "here". For each pair of
//      phones, the one whose name ("user:device") sorts first makes an "offer",
//      the other an "answer", and both trade "ice" (ways to reach each other).
//      Then the sound flows. In a group every pair does this (a "mesh"), so
//      eight people is the most: each phone sends to the seven others.
//   4. "leave" hangs up; "decline" says no; "busy" means on another call (or
//      the group call is full); "media" says a mic or camera went on or off.
//   5. Turning the camera on in a voice call (like WhatsApp's video button):
//      the camera's picture is added to each connection, which is set up again
//      with a fresh "offer" (by whichever phone turned it on). The others then
//      see me, and can turn their own camera on the same way.
//   2b. Connecting while it rings (owner, 25 Oct; for everyone since 31 Oct, through our relay
//      only when the caller isn't a saved contact), one-to-one calls: Sara's
//      "ringing" says she can ("early"). Ali's phone then offers a connection
//      straight away and they trade "ice" while it rings, but neither sends
//      anything yet: Ali's mic and camera are held back (empty senders), and
//      Sara's aren't even on. When she answers, both put their mic (and camera)
//      on the connection that's already there, so the call is live at once.
//      Her "join" and Ali's "here" say whether each kept it ("early"); if
//      either didn't (it never connected, a message got lost), both drop it
//      and connect the usual way below. Older phones never say "early".
//   6. Adding someone to a one-to-one call (like WhatsApp's "Add participant"):
//      it becomes a group call. They aren't in the chat, so each pair of
//      people talks through their own one-to-one chat instead (opened
//      quietly if they've never chatted; an empty chat isn't listed). Their
//      "ring" carries who else is in the call, so they connect to everyone.
//
// Only one call at a time. Its state lives here, outside any screen, so the
// call carries on while you look at your chats; the call screen
// (app/call.tsx) and the green bar on the chat list just show it.
import { MAX_CALL_PEOPLE, OfflineError, type CallEvent, type CallSignal, type Chat, type Device } from '@pakchat/shared';
import { router } from 'expo-router';
import KV from 'expo-sqlite/kv-store';
import { AppState, Dimensions, Vibration } from 'react-native';
import { mediaDevices, MediaStream, RTCIceCandidate, RTCPeerConnection, RTCSessionDescription, type MediaStreamTrack } from 'react-native-webrtc';

import { fileModule, type AudioRoute } from '../../modules/pakchat-signal';
import { en, ur, type Strings } from '../i18n/strings';
import { avatarTint, initials } from '../ui/letters';
import { core } from './core';
import { stopAll } from './player';
import { tuneSdp } from './sdp';
import { toneName } from './tones';

/** How long a call rings before it's "missed" (the same on both sides). */
export const RING_MS = 45_000;
/** A group call has room for this many phones. */
export const MAX_IN_CALL = MAX_CALL_PEOPLE;
/** How long to wait for the other phone after answering before giving up. */
const CONNECT_MS = 25_000;
/** The call messages that mean someone is in the call (not leaving or saying no). */
const IN_CALL_OPS: readonly CallSignal['op'][] = ['join', 'here', 'offer', 'answer', 'ice', 'media'];
/** How long a dropped connection may try to come back. */
const RECONNECT_MS = 15_000;

/** A call going on in a call link's chat, as this phone has heard of it. */
type LinkCall = { id: string; from: string; fromDevice: number; video: boolean; at: number; people: Set<string> };
/** A call link's call is taken to be over this long after it started, if nobody said they left. */
const LINK_CALL_MS = 6 * 3_600_000;

export type CallState = 'outgoing' | 'incoming' | 'connecting' | 'active' | 'ended';
export type EndReason = 'hungUp' | 'theyHungUp' | 'declined' | 'busy' | 'noAnswer' | 'missed' | 'failed' | 'elsewhere' | 'offline' | 'full' | 'permission';

/** One other phone in the call, as the screen shows it. */
export type PeerView = {
  key: string;
  userId: string;
  state: 'connecting' | 'connected' | 'reconnecting';
  audio: boolean;
  video: boolean;
  /** Their picture is their screen (shown whole, not cropped). */
  screen: boolean;
  stream: string | null;
  /** Goes up each time their sound or picture arrives anew, so the screen redraws it. */
  rev: number;
};

/** The call, as the screen shows it. */
export type CallView = {
  id: string;
  chatId: string;
  group: boolean;
  /** A video call (the camera can still be switched off). A voice call becomes one when a camera goes on. */
  video: boolean;
  direction: 'in' | 'out';
  state: CallState;
  /** Who started it. */
  from: string;
  /** When the first other phone connected (the timer starts). */
  startedAt: number | null;
  peers: PeerView[];
  muted: boolean;
  camera: boolean;
  front: boolean;
  local: string | null;
  route: AudioRoute;
  routes: AudioRoute[];
  endReason: EndReason | null;
  /** Calling out: a phone of theirs is ringing now ("Ringing…"; before that, "Calling…"). */
  ringing: boolean;
  /** People in the call who aren't in its chat: they were added to a one-to-one call. */
  extra: string[];
  /** People can be added (a call from a one-to-one chat, not a group chat's). */
  canAdd: boolean;
  /** I'm sharing my screen: everyone sees it instead of my camera. */
  sharing: boolean;
  /** Call waiting: someone else calling while I'm on this call (End & accept, or Decline). */
  waiting: { id: string; chatId: string; from: string; video: boolean; group: boolean } | null;
};

/** One call in the Calls tab. */
export type CallLogEntry = { id: string; chatId: string; with: string[]; direction: 'in' | 'out'; video: boolean; group: boolean; at: number; seconds: number; missed: boolean };

type Peer = {
  key: string;
  userId: string;
  deviceId: number;
  pc: RTCPeerConnection | null;
  stream: MediaStream | null;
  state: PeerView['state'];
  audio: boolean;
  video: boolean;
  screen: boolean;
  /** ICE that came before the offer or answer it belongs to. */
  pending: RTCIceCandidate[];
  rev: number;
  /** Stops waiting for a dropped connection to come back. */
  giveUp: (() => void) | null;
  /** Connected while it rang (see 2b at the top). */
  early: boolean;
  /**
   * Only through our relay (TURN): connecting while it rings for someone who isn't
   * in my contacts, so their phone never learns my address (owner, 31 Oct).
   */
  relayOnly?: boolean;
  /** `stream` was put together here from their tracks (it's released with the connection). */
  ownStream: boolean;
};

type Live = Omit<CallView, 'peers' | 'local' | 'waiting'> & {
  fromDevice: number;
  peers: Map<string, Peer>;
  localStream: MediaStream | null;
  /** My screen, while I share it (sent instead of my camera). */
  screenStream: MediaStream | null;
  /** I'm in it (I started it, or answered). */
  joined: boolean;
  /** Ever connected to anyone. */
  connectedOnce: boolean;
  /** Who said no (group calls end when everyone has). */
  declined: Set<string>;
  members: string[];
  /** Which chat to use to reach someone added to the call (their one-to-one chat with me). */
  links: Map<string, string>;
  /** New group call (Calls › New group call): the others, rung once the first one answers. */
  invite: string[];
  cancel: (() => void)[];
  done: boolean;
  /** The connection made while it rings, until it's answered (one-to-one calls; see 2b at the top). */
  early: Peer | null;
};

/** A ringing call, kept so it survives PakChat being started by the ringing alert. */
type Ringing = { id: string; chatId: string; from: string; fromDevice: number; video: boolean; group: boolean; until: number; extra?: string[]; canAdd?: boolean };
const RINGING = 'call:ringing';

// ---- Small helpers ----

type PcEvents = {
  addEventListener(type: 'icecandidate', fn: (e: { candidate: RTCIceCandidate | null }) => void): void;
  addEventListener(type: 'track', fn: (e: { streams: MediaStream[]; track?: MediaStreamTrack }) => void): void;
  addEventListener(type: 'connectionstatechange', fn: () => void): void;
};

/** The camera's picture: smaller and slower with "Use less data for calls". */
function cameraSize() {
  return core.settings.lessDataCalls ? { width: 320, height: 240, frameRate: 15 } : { width: 640, height: 480, frameRate: 24 };
}

/**
 * How a shared screen is captured. The whole screen, never just one app (Android 14
 * and later offer "one app" first; that app's picture freezes once you leave it).
 * And at most 1280 pixels on its longer side, about what WhatsApp sends: a phone's
 * full screen (nearly 3000 pixels tall on a Pixel 8 Pro) is more than many phones'
 * video encoders take, and then the other phone only sees a frozen picture.
 */
function screenSize() {
  const { width, height, scale } = Dimensions.get('screen');
  const longest = Math.max(width, height) * scale;
  return { createConfigForDefaultDisplay: true, resolutionScale: longest > 1280 ? 1280 / longest : 1 };
}

type TrackEvents = { addEventListener(type: 'ended', fn: () => void): void };

const keyOf = (d: Device) => `${d.userId}:${d.deviceId}`;

/** Runs `fn` after `ms` by the phone's own clock (JavaScript timers stop in the background). */
function later(ms: number, fn: () => void) {
  let live = true;
  void fileModule()
    .wait(Math.max(0, Math.min(ms, 60_000)))
    .then(() => {
      if (live) fn();
    });
  return () => {
    live = false;
  };
}

/** Fetches the names of people in the call that this phone doesn't know yet (someone added). */
function knowNames(userIds: string[]) {
  for (const u of userIds) if (!core.people[u]) void core.person(u).catch(() => {});
}

function words(): Strings {
  try {
    const saved = KV.getItemSync('prefs.look');
    return saved && (JSON.parse(saved) as { lang?: string }).lang === 'ur' ? ur : en;
  } catch {
    return en;
  }
}

// ---- The engine ----

class Calls {
  private call: Live | null = null;
  /** The call screen is showing (so a tapped alert doesn't open a second one, and the green bar hides). */
  screenOpen = false;

  setScreenOpen(on: boolean) {
    if (this.screenOpen === on) return;
    this.screenOpen = on;
    this.emit();
  }
  private listeners = new Set<() => void>();
  /** Calls that are over, so a late message about one is ignored. */
  private finished: string[] = [];
  private ice: { servers: { urls: string[]; username?: string; credential?: string }[]; at: number } | null = null;
  /**
   * Call links: a call in a call link's chat never rings anyone. Each phone
   * just notes it here (who's in it), so opening the link joins it.
   */
  private linkCalls = new Map<string, LinkCall>();
  private linkChats = new Map<string, boolean>();
  private audioWatch: { remove: () => void } | null = null;
  /** Call waiting, like WhatsApp: a second call ringing while I'm on one, until I pick or it stops. */
  private waiting: (Ringing & { at: number; stop: () => void }) | null = null;

  /** A call is going on (or ringing): the connection to the server stays open. */
  get live() {
    return !!this.call && !this.call.done;
  }

  // ---- For the screens ----

  on(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  /** The call now (null if none), as plain data. */
  view(): CallView | null {
    const c = this.call;
    if (!c) return null;
    const { fromDevice: _f, peers, localStream, screenStream: _s, joined: _j, connectedOnce: _c, declined: _d, members: _m, links: _l, cancel: _x, done: _done, early: _e, ...rest } = c;
    const w = this.waiting;
    return {
      ...rest,
      waiting: w && !c.done ? { id: w.id, chatId: w.chatId, from: w.from, video: w.video, group: w.group } : null,
      extra: [...c.extra],
      // While I share my screen, my own tile says so (like WhatsApp) instead of showing it back to me.
      local: localStream && c.camera && !c.sharing ? localStream.toURL() : null,
      peers: [...peers.values()].map((p) => ({ key: p.key, userId: p.userId, state: p.state, audio: p.audio, video: p.video, screen: p.screen, stream: p.stream ? p.stream.toURL() : null, rev: p.rev })),
    };
  }

  // ---- Starting a call ----

  /**
   * Calls everyone in a chat. `ready` is told the call's id as soon as it
   * exists (to open the call screen while the mic and camera start).
   */
  async start(chatId: string, video: boolean, ready?: (callId: string) => void, invite: string[] = []): Promise<'started' | 'busy' | 'offline' | 'permission'> {
    if (this.call && !this.call.done) return this.call.chatId === chatId ? 'started' : 'busy';
    const chat = await core.storage.getChat(chatId);
    if (!chat || chat.kind === 'status') return 'offline';
    if (!core.client.isConnected) return 'offline';
    const me = core.client.device;
    // Fetched now, while it rings, so it connects sooner once they answer.
    void this.iceServers();
    const c = this.fresh({
      id: core.newId(),
      chatId,
      group: chat.kind === 'group',
      video,
      direction: 'out',
      state: 'outgoing',
      from: me.userId,
      fromDevice: me.deviceId,
      joined: true,
      members: this.othersIn(chat),
      canAdd: chat.kind === 'direct',
    });
    c.invite = chat.kind === 'direct' ? invite : [];
    this.call = c;
    this.emit();
    ready?.(c.id);
    if (!(await this.media(c))) {
      // Hung up while the mic was starting: nothing more to do (and no "allow the mic" message).
      if (c.done) return 'started';
      this.end(c, 'permission');
      return 'permission';
    }
    stopAll();
    const audio = fileModule();
    audio.callAudioStart(video);
    this.watchAudio(c);
    // No ringing sound yet: it starts when their phone says it's ringing (like WhatsApp's "Calling…" then "Ringing…").
    // Everyone in the chat rings; closed phones are woken for it. A call link's call rings nobody: people join from the link.
    const rang = await this.send(c, { op: 'ring', video, group: c.group }, undefined, !chat.callLink);
    // Hung up already (before the ring got out): it's over.
    if (c.done) return 'started';
    if (!rang) {
      this.end(c, 'offline');
      return 'offline';
    }
    this.ongoing(c);
    if (chat.callLink) {
      this.linkCalls.set(chatId, { id: c.id, from: me.userId, fromDevice: me.deviceId, video, at: Date.now(), people: new Set([me.userId]) });
      return 'started';
    }
    c.cancel.push(
      later(RING_MS, () => {
        // Nobody answered: stop their ringing (waking them if need be).
        if (c.done || c.connectedOnce || c.peers.size) return;
        void this.send(c, { op: 'leave' }, undefined, true);
        this.end(c, 'noAnswer');
      }),
    );
    return 'started';
  }

  private fresh(x: Pick<Live, 'id' | 'chatId' | 'group' | 'video' | 'direction' | 'state' | 'from' | 'fromDevice' | 'joined' | 'members' | 'canAdd'> & { extra?: string[] }): Live {
    return {
      extra: [],
      links: new Map(),
      invite: [],
      ...x,
      startedAt: null,
      peers: new Map(),
      localStream: null,
      screenStream: null,
      sharing: false,
      muted: false,
      camera: x.video,
      front: true,
      route: x.video ? 'speaker' : 'earpiece',
      routes: ['earpiece', 'speaker'],
      endReason: null,
      ringing: false,
      connectedOnce: false,
      declined: new Set(),
      cancel: [],
      done: false,
      early: null,
    };
  }

  private othersIn(chat: Chat) {
    return chat.members.map((m) => m.userId).filter((id) => id !== core.myId);
  }

  /** Opens the mic (and camera). False if you said no. */
  private async media(c: Live) {
    try {
      const stream = await mediaDevices.getUserMedia({
        audio: true,
        video: c.video ? { facingMode: 'user', ...cameraSize() } : false,
      });
      if (c.done) {
        stream.getTracks().forEach((t) => t.stop());
        stream.release();
        return false;
      }
      c.localStream = stream;
      this.emit();
      return true;
    } catch {
      return false;
    }
  }

  // ---- Adding people ----

  /**
   * Adds people to a one-to-one call, which becomes a group call: their phones
   * ring, and the "ring" tells them who else is in it. False if nobody could be rung.
   */
  async add(userIds: string[]) {
    const c = this.call;
    if (!c || c.done || !c.canAdd || c.state !== 'active') return false;
    const inCall = new Set([core.myId, ...c.members, ...c.extra]);
    const fresh = userIds.filter((u) => !inCall.has(u)).slice(0, Math.max(0, MAX_IN_CALL - inCall.size));
    if (!fresh.length) return false;
    const people = [...inCall];
    c.group = true;
    c.extra = [...c.extra, ...fresh];
    this.emit();
    let rang = false;
    for (const u of fresh) {
      const chatId = await this.linkFor(c, u);
      if (c.done) return rang;
      if (chatId && (await this.sendTo(chatId, c.id, { op: 'ring', video: c.video, group: true, people }, undefined, true))) {
        rang = true;
        // Not answered in time: they're no longer shown as in the call.
        c.cancel.push(later(RING_MS, () => !c.done && this.dropInvite(c, u)));
      } else this.dropInvite(c, u);
    }
    return rang;
  }

  /** Someone added didn't come, or left: off the list (unless one of their phones is still connected). */
  private dropInvite(c: Live, userId: string) {
    if (!c.extra.includes(userId) || [...c.peers.values()].some((p) => p.userId === userId)) return;
    c.extra = c.extra.filter((u) => u !== userId);
    this.emit();
  }

  /** The chat that reaches someone added to the call: our one-to-one chat (opened if need be). */
  private async linkFor(c: Live, userId: string) {
    const known = c.links.get(userId);
    if (known) return known;
    try {
      const chat = await core.client.openDirect(userId);
      c.links.set(userId, chat.id);
      return chat.id;
    } catch {
      return null;
    }
  }

  // ---- Ringing ----

  /** Answers the ringing call. */
  async answer() {
    const c = this.call;
    if (!c || c.state !== 'incoming') return;
    fileModule().callStopRing(c.id);
    void KV.removeItem(RINGING).catch(() => {});
    c.state = 'connecting';
    c.joined = true;
    this.emit();
    stopAll();
    // The mic (and camera) start while we make sure we're connected: both at once, not one after the other.
    const online = this.connected();
    if (!(await this.media(c))) return this.end(c, 'permission');
    fileModule().callAudioStart(c.video);
    this.watchAudio(c);
    // Connected while it rang: my mic (and camera) go on that connection now.
    const early = this.keepEarly(c);
    if (!(await online)) return this.end(c, 'offline');
    if (c.done) return;
    // Tell everyone (the caller, others in a group, and my other phones), and meanwhile put my
    // mic (and camera) on the connection made while it rang, so the sound flows the moment they hear.
    const joined = this.send(c, { op: 'join', video: c.camera, audio: true, ...(early ? { early: true } : {}) }, undefined, true);
    if (early) {
      await this.sendTracks(c, early);
      if (!c.done && early.pc?.connectionState === 'connected') this.connectionChanged(c, early);
    }
    if (!(await joined)) return this.end(c, 'offline');
    this.ongoing(c);
    c.cancel.push(
      later(CONNECT_MS, () => {
        if (!c.done && !c.connectedOnce) this.end(c, 'failed');
      }),
    );
  }

  // ---- Call links ----

  private async isLink(chatId: string) {
    let on = this.linkChats.get(chatId);
    if (on === undefined) {
      on = !!(await core.storage.getChat(chatId))?.callLink;
      this.linkChats.set(chatId, on);
    }
    return on;
  }

  /** Who's in a call link's call now (none: nobody's in it). */
  linkCall(chatId: string): { id: string; people: string[]; video: boolean } | null {
    const l = this.linkCalls.get(chatId);
    if (!l || !l.people.size || Date.now() - l.at > LINK_CALL_MS || this.finished.includes(l.id)) return null;
    return { id: l.id, people: [...l.people], video: l.video };
  }

  /**
   * Notes a call message in a call link's chat. True: it's dealt with here (a
   * "ring" never rings; it only says a call is going on there).
   */
  private linkSignal(e: CallEvent, from: Device) {
    const s = e.signal;
    const mine = e.from === core.myId;
    const known = this.linkCalls.get(e.chatId);
    if (s.op === 'ring') {
      if (mine) return true;
      const now = this.call && !this.call.done && this.call.chatId === e.chatId ? this.call : null;
      if (now && now.id !== s.call) {
        if (now.joined && (now.peers.size || now.connectedOnce)) {
          // Someone started a second call here: tell them about ours, so they come to it.
          void this.sendTo(e.chatId, now.id, { op: 'ring', video: now.video, group: true }, [from]);
          return true;
        }
        // I'm alone in mine, and theirs has someone: mine goes, and I join theirs (the smaller id wins a tie).
        if (now.direction === 'out' && !now.peers.size && (!known || known.id !== now.id || s.call < now.id)) {
          this.end(now, 'hungUp', true);
          void this.send(now, { op: 'leave' });
          this.linkCalls.set(e.chatId, { id: s.call, from: e.from, fromDevice: e.fromDevice, video: !!s.video, at: e.at, people: new Set([e.from]) });
          void this.joinLink(e.chatId, now.video, (id) => this.screenOpen && router.setParams({ id }));
          return true;
        }
        return true;
      }
      if (!known || known.id !== s.call) this.linkCalls.set(e.chatId, { id: s.call, from: e.from, fromDevice: e.fromDevice, video: !!s.video, at: e.at, people: new Set([e.from]) });
      core.emit('calls');
      return true;
    }
    if (known && known.id === s.call) {
      if (s.op === 'join' || s.op === 'here') known.people.add(e.from);
      if (s.op === 'leave') known.people.delete(e.from);
      core.emit('calls');
    }
    return false;
  }

  /** Opens a call link's call: joins the one going on there, or starts one (which rings nobody). */
  async joinLink(chatId: string, video: boolean, ready?: (callId: string) => void): Promise<'started' | 'busy' | 'offline' | 'permission'> {
    if (this.call && !this.call.done) return this.call.chatId === chatId ? 'started' : 'busy';
    const l = this.linkCall(chatId);
    if (!l) return this.start(chatId, video, ready);
    const k = this.linkCalls.get(chatId)!;
    const extra = l.people.filter((u) => u !== core.myId);
    knowNames(extra);
    this.ring({ id: k.id, chatId, from: k.from, fromDevice: k.fromDevice, video, group: true, extra: [], canAdd: false, until: Date.now() + RING_MS }, RING_MS, false);
    ready?.(k.id);
    await this.answer();
    return 'started';
  }

  /** Says no to the ringing call. */
  async decline() {
    const c = this.call;
    if (!c || c.state !== 'incoming') return;
    fileModule().callStopRing(c.id);
    this.end(c, 'declined');
    // My other phones stop ringing too, so they're woken for it.
    await this.whenConnected(() => this.send(c, { op: 'decline' }, undefined, true));
  }

  // ---- Call waiting ----

  private wait(r: Ringing, ms: number, at: number) {
    const stop = later(ms, () => {
      if (this.waiting?.id === r.id) this.dropWaiting(true);
    });
    this.waiting = { ...r, at, stop };
    // The caller hears it ringing; I feel a buzz (the call's sound carries on).
    void this.whenConnected(() => this.sendTo(r.chatId, r.id, { op: 'ringing' }, [{ userId: r.from, deviceId: r.fromDevice }])).catch(() => {});
    Vibration.vibrate([0, 250, 200, 250]);
    this.emit();
    // Looking at my chats: the call screen comes up to show it.
    if (AppState.currentState === 'active' && !this.screenOpen && this.call) router.push({ pathname: '/call', params: { id: this.call.id } });
  }

  /** The waiting call is over without me picking it up: `missed`, it's a missed call. */
  private dropWaiting(missed: boolean) {
    const w = this.waiting;
    if (!w) return;
    this.waiting = null;
    w.stop();
    Vibration.cancel();
    this.remember(w.id);
    if (missed) void this.logMissed(w.chatId, w.id, w.from, w.video, w.group, w.at);
    this.emit();
  }

  /** "Decline" on the waiting call: the caller is told, and the call I'm on carries on. */
  async declineWaiting() {
    const w = this.waiting;
    if (!w) return;
    this.dropWaiting(false);
    await addToLog({ id: w.id, chatId: w.chatId, with: [w.from], direction: 'in', video: w.video, group: w.group, at: w.at, seconds: 0, missed: true });
    await core.client.noteCall(w.chatId, w.id, { by: w.from, video: w.video, group: w.group, missed: true, seconds: 0 }, w.at).catch(() => {});
    await this.whenConnected(() => this.sendTo(w.chatId, w.id, { op: 'decline' }, undefined, true));
  }

  /** "End & accept": hangs up this call and answers the waiting one. */
  async acceptWaiting() {
    const w = this.waiting;
    if (!w) return;
    this.waiting = null;
    w.stop();
    Vibration.cancel();
    const { at: _at, stop: _stop, ...r } = w;
    await this.hangUp();
    this.ring(r, Math.max(10_000, r.until - Date.now()), false);
    await this.answer();
  }

  /** Hangs up (or stops calling). */
  async hangUp() {
    const c = this.call;
    if (!c || c.done) return;
    if (c.state === 'incoming') return this.decline();
    // Before anyone answered, their phones may be closed and ringing: wake them to stop.
    const ringing = !c.connectedOnce;
    this.end(c, 'hungUp');
    await this.send(c, { op: 'leave' }, undefined, ringing);
  }

  /** Decline or Hang up pressed on the call's alert (background.ts). */
  async onAction(action: string, callId: string) {
    await core.init();
    if (!this.call) this.restore(callId);
    if (this.call?.id !== callId) return;
    if (action === 'decline') await this.decline();
    else await this.hangUp();
  }

  /** Brings back a call that was ringing before PakChat was (re)started. */
  restore(callId: string) {
    if (this.call && !this.call.done) return this.call.id === callId;
    try {
      const r = JSON.parse(KV.getItemSync(RINGING) ?? 'null') as Ringing | null;
      if (!r || r.id !== callId || r.until <= Date.now()) return false;
      this.ring(r, r.until - Date.now(), false);
      return true;
    } catch {
      return false;
    }
  }

  /** Rings here. `announce`: show the ringing alert and the call screen (not when restoring one, or answering at once). */
  private ring(r: Ringing, ms: number, announce: boolean) {
    const c = this.fresh({ id: r.id, chatId: r.chatId, group: r.group, video: r.video, direction: 'in', state: 'incoming', from: r.from, fromDevice: r.fromDevice, joined: false, members: [], extra: r.extra ?? [], canAdd: r.canAdd ?? false });
    this.call = c;
    void core.storage.getChat(r.chatId).then((chat) => {
      if (chat) c.members = this.othersIn(chat);
    });
    KV.setItemSync(RINGING, JSON.stringify(r));
    if (announce) {
      void this.showRing(c);
      // Tell the caller's phone it's ringing here, so it shows "Ringing…", and (one to one)
      // that it can start connecting now.
      const caller = { userId: c.from, deviceId: c.fromDevice };
      // Anyone (owner, 31 Oct): a call from someone not in my contacts connects only
      // through our relay while it rings, so they don't learn my address unless I answer.
      if (!r.group) {
        c.early = this.newPeer(c, caller, true);
        if (!core.isContact(c.from)) c.early.relayOnly = true;
      }
      void this.whenConnected(() => this.sendTo(c.chatId, c.id, { op: 'ringing', ...(c.early ? { early: true } : {}) }, [caller])).catch(() => {});
    }
    c.cancel.push(
      later(ms, () => {
        if (!c.done && c.state === 'incoming') this.end(c, 'missed');
      }),
    );
    this.emit();
    // Open on screen: show the call. (Closed or in the background, the alert shows it.)
    if (announce && AppState.currentState === 'active' && !this.screenOpen) router.push({ pathname: '/call', params: { id: c.id } });
  }

  /** The ringing alert: full screen on a locked phone, with the ringtone. */
  private async showRing(c: Live) {
    const t = words();
    const chat = await core.storage.getChat(c.chatId);
    const title = chat?.kind === 'group' ? `${core.chatTitle(chat)}` : core.name(c.from) || t.unknownCaller;
    fileModule().callRing(
      JSON.stringify({
        callId: c.id,
        chatId: c.chatId,
        title,
        text: c.group ? (c.video ? t.incomingGroupVideo : t.incomingGroupVoice) : c.video ? t.incomingVideo : t.incomingVoice,
        video: c.video,
        // The ringtone picked in Settings › Notifications › Calls ('' is the phone's own).
        tone: core.settings.callTone ?? '',
        avatar: { ...avatarTint(c.group ? c.chatId : c.from), letters: initials(title) },
        words: { ringChannel: t.callsChannel, missedChannel: t.missedCallsChannel, ongoingChannel: t.ongoingCallsChannel, answer: t.answer, decline: t.decline, toneName: toneName(core.settings.callTone, t) },
      }),
    );
  }

  // ---- Call messages from other phones ----

  /** Every call message that arrives (from core.ts). */
  onSignal(e: CallEvent) {
    void this.handle(e).catch((err: unknown) => console.log(`[pakchat] call: ${String(err)}`));
  }

  private async handle(e: CallEvent) {
    const s = e.signal;
    const from: Device = { userId: e.from, deviceId: e.fromDevice };
    const mine = e.from === core.myId;
    if (this.finished.includes(s.call) && s.op !== 'ring') return;
    const c = this.call && this.call.id === s.call && !this.call.done ? this.call : null;

    // Someone added to a one-to-one call talks to me through our own chat, not the call's.
    if (c && e.chatId !== c.chatId) {
      // (My own other phones send there too; the call's chat already told them.)
      if (!c.canAdd || mine) return;
      c.links.set(e.from, e.chatId);
      if (IN_CALL_OPS.includes(s.op) && !c.members.includes(e.from) && !c.extra.includes(e.from)) {
        c.extra = [...c.extra, e.from];
        c.group = true;
        knowNames([e.from]);
        this.emit();
      }
    }

    if (await this.isLink(e.chatId)) {
      if (this.linkSignal(e, from)) return;
    }

    // The call that's waiting: the caller gave up, or I picked it up or said no on another phone.
    const w = this.waiting;
    if (w && w.id === s.call && !c) {
      if (s.op === 'leave' && e.from === w.from) this.dropWaiting(true);
      else if (mine && (s.op === 'join' || s.op === 'decline')) this.dropWaiting(false);
      return;
    }

    switch (s.op) {
      case 'ring':
        if (mine || this.finished.includes(s.call) || c) return;
        return this.incoming(e, from);
      case 'ringing':
        // Their phone is ringing: "Calling…" becomes "Ringing…", with the ringing sound.
        if (!c || mine || c.direction !== 'out' || c.state !== 'outgoing') return;
        if (s.early) this.startEarly(c, from);
        if (c.ringing) return;
        c.ringing = true;
        fileModule().callTone('ringing');
        this.ongoing(c);
        return this.emit();
      case 'join':
        if (!c) return;
        // I answered on another of my phones: this one stops ringing.
        if (mine && c.state === 'incoming') return this.end(c, 'elsewhere');
        if (!c.joined) return;
        return this.someoneJoined(c, from, s);
      case 'here': {
        if (!c?.joined) return;
        const p = c.peers.get(keyOf(from));
        // I kept the connection made while it rang, but they didn't: start again the usual way.
        if (p?.early && !s.early) this.dropEarly(p);
        return this.meet(c, from, s);
      }
      case 'offer':
        // Ringing here: the caller's phone connecting early (see 2b at the top).
        if (c && !c.joined && s.sdp && c.early?.key === keyOf(from)) return this.gotOffer(c, from, s.sdp);
        if (!c?.joined || !s.sdp) return;
        return this.gotOffer(c, from, s.sdp);
      case 'answer':
        if (!c?.joined || !s.sdp) return;
        return this.gotAnswer(c, from, s.sdp);
      case 'ice':
        if (c && !c.joined && s.cand && c.early?.key === keyOf(from)) return this.gotIce(c, from, s.cand);
        if (!c?.joined || !s.cand) return;
        return this.gotIce(c, from, s.cand);
      case 'media': {
        const p = c?.peers.get(keyOf(from));
        if (!p) return;
        if (s.audio !== undefined) p.audio = s.audio;
        if (s.video !== undefined) {
          p.video = s.video;
          p.screen = !!s.screen;
        }
        if (c && s.video && !c.video) {
          // They turned their camera on in a voice call: show them, on the loudspeaker, like WhatsApp.
          c.video = true;
          fileModule().callVideo(true);
        }
        return this.emit();
      }
      case 'leave':
        if (!c) return;
        return this.someoneLeft(c, from);
      case 'decline':
        if (!c) return;
        if (!mine) this.dropInvite(c, e.from);
        if (mine) {
          // I said no on another phone.
          if (c.state === 'incoming') this.end(c, 'elsewhere');
          return;
        }
        c.declined.add(e.from);
        if (c.direction === 'out' && !c.connectedOnce && !c.peers.size && (!c.group || c.members.every((m) => c.declined.has(m)))) this.end(c, 'declined');
        return;
      case 'busy':
        if (c) this.dropInvite(c, e.from);
        if (!c || c.connectedOnce) return;
        // Calling: they're on another call. Joining a group call: it's full.
        if (c.direction === 'out' && !c.group) {
          this.end(c, 'busy');
          // Their other phones may still be ringing.
          void this.send(c, { op: 'leave' }, undefined, true);
        } else if (c.direction === 'in' && c.joined && !c.peers.size) this.end(c, 'full');
        return;
    }
  }

  private async incoming(e: CallEvent, from: Device) {
    const s = e.signal;
    // Fetched while it rings, so answering connects sooner.
    void this.iceServers();
    // How long ago it was rung (by the server's clock, which phones roughly share).
    const age = Date.now() - e.at;
    const fresh = age < RING_MS - 3_000 || Math.abs(age) > 120_000;
    const left = Math.abs(age) > 120_000 ? 30_000 : Math.max(10_000, RING_MS - Math.max(0, age));
    // Added to someone's call: who else is in it (they'll connect to me when I answer).
    const extra = (s.people ?? []).filter((u) => u !== core.myId && u !== e.from);
    knowNames(extra);
    const canAdd = (await core.storage.getChat(e.chatId))?.kind === 'direct';
    const ringing = { id: s.call, chatId: e.chatId, from: e.from, fromDevice: e.fromDevice, video: !!s.video, group: !!s.group || extra.length > 0, extra, canAdd };
    const now = this.call && !this.call.done ? this.call : null;
    if (now) {
      // We called each other at the same moment: the call with the smaller id wins, on both phones.
      if (now.direction === 'out' && now.state === 'outgoing' && now.chatId === e.chatId && !now.group && !s.group && s.call < now.id) {
        const mineGoes = now;
        this.end(mineGoes, 'hungUp', true);
        void this.send(mineGoes, { op: 'leave' });
        this.ring({ ...ringing, until: Date.now() + left }, left, false);
        return this.answer();
      }
      if (now.direction === 'out' && now.state === 'outgoing' && now.chatId === e.chatId && !now.group && !s.group) return;
      // Call waiting, like WhatsApp: on a call I'm in, a second call shows on the call screen
      // (End & accept, or Decline) instead of "busy". Not a stranger's with "Silence unknown callers".
      const silenced = core.settings.silenceUnknown && !s.group && !extra.length && !core.isContact(e.from);
      if (fresh && !silenced && !this.waiting && now.joined && now.chatId !== e.chatId) return this.wait({ ...ringing, until: Date.now() + left }, left, e.at);
      // On another call: "busy", and it's a missed call here.
      await this.sendTo(e.chatId, s.call, { op: 'busy' }, [from]);
      this.remember(s.call);
      return this.logMissed(e.chatId, s.call, e.from, !!s.video, !!s.group, e.at);
    }
    if (!fresh) {
      // Rung while the phone was off long enough that it's already over.
      this.remember(s.call);
      return this.logMissed(e.chatId, s.call, e.from, !!s.video, !!s.group, e.at);
    }
    // Silence unknown callers (Settings › Privacy › Calls), like WhatsApp: someone not in my
    // contacts doesn't ring; it's in Calls and the alerts as a missed call.
    if (core.settings.silenceUnknown && !s.group && !extra.length && !core.isContact(e.from)) {
      this.remember(s.call);
      return this.logMissed(e.chatId, s.call, e.from, !!s.video, false, e.at);
    }
    this.ring({ ...ringing, until: Date.now() + left }, left, true);
  }

  private someoneJoined(c: Live, from: Device, s: CallSignal) {
    const key = keyOf(from);
    if (!c.peers.has(key) && c.peers.size >= MAX_IN_CALL - 1) {
      // The call is full: "busy" to them.
      void this.send(c, { op: 'busy' }, [from]);
      return;
    }
    // Connected while it rang: kept if that's the phone that answered, and it kept it too.
    let early: Peer | null = null;
    const e = c.early;
    if (e && e.userId === from.userId) {
      c.early = null;
      if (e.key === key && s.early && e.pc?.remoteDescription) {
        early = e;
        c.peers.set(key, e);
      } else this.closePeer(e);
    }
    // "I'm here": they connect with me (and with everyone else who answers the same).
    void this.send(c, { op: 'here', video: c.camera, audio: !c.muted, ...(early ? { early: true } : {}) }, [from]);
    this.meet(c, from, s);
    if (early) {
      void this.sendTracks(c, early).then(() => {
        if (!c.done && early.pc?.connectionState === 'connected') this.connectionChanged(c, early);
      });
    }
  }

  /** Starts connecting to another phone in the call. */
  private meet(c: Live, from: Device, s: CallSignal) {
    const p = this.peer(c, from);
    if (s.audio !== undefined) p.audio = s.audio;
    if (s.video !== undefined) p.video = s.video;
    if (c.state === 'outgoing') {
      c.state = 'connecting';
      fileModule().callStopTone();
      // Someone answered: if no sound gets through soon, stop trying (rather than "Connecting…" for ever).
      c.cancel.push(
        later(CONNECT_MS, () => {
          if (!c.done && !c.connectedOnce) this.end(c, 'failed');
        }),
      );
    }
    this.emit();
    // The phone whose name sorts first makes the offer.
    if (keyOf(core.client.device) < p.key && !p.pc) void this.offer(c, p);
  }

  private peer(c: Live, from: Device): Peer {
    const key = keyOf(from);
    let p = c.peers.get(key);
    if (!p) {
      p = this.newPeer(c, from, false);
      c.peers.set(key, p);
    }
    return p;
  }

  private newPeer(c: Live, from: Device, early: boolean): Peer {
    return { key: keyOf(from), userId: from.userId, deviceId: from.deviceId, pc: null, stream: null, state: 'connecting', audio: true, video: c.video, screen: false, pending: [], giveUp: null, rev: 0, early, ownStream: false };
  }

  /** In the call, or the connection made while it rings. */
  private find(c: Live, from: Device): Peer | undefined {
    const key = keyOf(from);
    return c.peers.get(key) ?? (c.early?.key === key ? c.early : undefined);
  }

  // ---- Connecting while it rings (see 2b at the top) ----

  /** Calling: their phone is ringing and can connect now. My phone offers; nothing is sent until they answer. */
  private startEarly(c: Live, from: Device) {
    const key = keyOf(from);
    if (c.group || c.early || c.peers.has(key) || !c.localStream) return;
    const p = this.newPeer(c, from, true);
    c.early = p;
    void this.offer(c, p);
  }

  /** Answering: keeps the connection made while it rang, if it got that far (else drops it). */
  private keepEarly(c: Live): Peer | null {
    const e = c.early;
    if (!e) return null;
    c.early = null;
    // Through the relay only (a non-contact's call): kept only if it really got through.
    const through = !e.relayOnly || e.pc?.connectionState === 'connected';
    if (e.pc?.remoteDescription && e.pc.localDescription && through) {
      c.peers.set(e.key, e);
      return e;
    }
    this.closePeer(e);
    return null;
  }

  /** The other phone didn't keep the early connection: drop it, to connect the usual way. */
  private dropEarly(p: Peer) {
    this.closePeer(p);
    p.early = false;
    p.pending = [];
    p.stream = null;
    p.state = 'connecting';
    p.rev++;
  }

  /** Puts my mic (and camera) on a connection made while it rang, whose senders were left empty. */
  private async sendTracks(c: Live, p: Peer) {
    const local = c.localStream;
    if (!local || !p.pc) return;
    for (const t of p.pc.getTransceivers()) {
      if (t.sender.track) continue;
      const kind = t.receiver.track?.kind;
      const track = local.getTracks().find((x) => x.kind === kind);
      if (!track) continue;
      try {
        await t.sender.replaceTrack(track);
      } catch (err) {
        console.log(`[pakchat] call early tracks: ${String(err)}`);
      }
    }
    void this.saveData(p);
  }

  private someoneLeft(c: Live, from: Device) {
    if (c.state === 'incoming') {
      // The caller gave up before I answered (in a group, only the caller's leaving stops the ringing).
      if (!c.group || from.userId === c.from) this.end(c, 'missed');
      return;
    }
    const p = c.peers.get(keyOf(from));
    if (p) {
      this.closePeer(p);
      c.peers.delete(p.key);
      this.emit();
    }
    this.dropInvite(c, from.userId);
    if (!c.peers.size && (c.connectedOnce || !c.group)) this.end(c, 'theyHungUp');
  }

  // ---- Connecting two phones (WebRTC) ----

  private async iceServers() {
    if (this.ice && Date.now() - this.ice.at < 3_600_000) return this.ice.servers;
    try {
      this.ice = { servers: await core.server.iceServers(), at: Date.now() };
      return this.ice.servers;
    } catch {
      return this.ice?.servers ?? [{ urls: ['stun:stun.l.google.com:19302'] }];
    }
  }

  private async connection(c: Live, p: Peer) {
    if (p.pc) return p.pc;
    const iceServers = await this.iceServers();
    // Protect IP address in calls (Settings › Privacy): only through our relay, so the
    // other phone never learns my address. Only when there is a relay to go through.
    const hasRelay = iceServers.some((x) => [x.urls].flat().some((u) => /^turns?:/i.test(u)));
    // Relay-only while it rings for a non-contact even with no relay to hand: then it simply
    // doesn't connect early (never a way round it), and connects the usual way on answering.
    const relay = (!!core.settings.protectIp && hasRelay) || !!p.relayOnly;
    const pc = new RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle', iceTransportPolicy: relay ? 'relay' : 'all' });
    if (p.pc) {
      pc.close();
      return p.pc;
    }
    p.pc = pc;
    const local = c.localStream;
    // Connecting while it rings: room for my sound (and picture), sent only once it's answered (sendTracks).
    if (p.early && c.early === p) {
      if (local) for (const track of local.getTracks()) pc.addTransceiver(track.kind as 'audio' | 'video', { direction: 'sendrecv', streams: [local] });
    } else if (local) for (const track of local.getTracks()) pc.addTrack(track, local);
    // Someone joining while I share my screen gets my screen, not my camera.
    const screen = c.screenStream?.getVideoTracks()[0];
    if (screen && local) {
      const camera = pc.getSenders().find((x) => x.track?.kind === 'video');
      if (camera) void camera.replaceTrack(screen).catch(() => {});
      else pc.addTrack(screen, local);
    }
    // (The library's own event types don't load, so these are spelled out.)
    const events = pc as unknown as PcEvents;
    events.addEventListener('icecandidate', (ev) => {
      const cand = ev.candidate;
      if (!cand || c.done) return;
      void this.send(c, { op: 'ice', cand: { candidate: cand.candidate, sdpMid: cand.sdpMid ?? null, sdpMLineIndex: cand.sdpMLineIndex ?? null } }, [p]);
    });
    events.addEventListener('track', (ev) => {
      let stream = ev.streams[0];
      // A track without a stream (theirs, from a connection made while it rang): kept in one of our own.
      if (!stream && ev.track) {
        if (!p.ownStream || !p.stream) {
          p.stream = new MediaStream();
          p.ownStream = true;
        }
        stream = p.stream;
        stream.addTrack(ev.track);
      }
      if (stream) {
        p.stream = stream;
        p.rev++;
        this.emit();
      }
    });
    events.addEventListener('connectionstatechange', () => this.connectionChanged(c, p));
    return pc;
  }

  private async offer(c: Live, p: Peer, restart = false) {
    try {
      const pc = await this.connection(c, p);
      if (c.done) return;
      const made = (await pc.createOffer(restart ? { iceRestart: true } : {})) as { sdp: string; type: 'offer' };
      const offer = { type: 'offer' as const, sdp: tuneSdp(made.sdp) };
      await pc.setLocalDescription(new RTCSessionDescription(offer));
      void this.saveData(p);
      await this.send(c, { op: 'offer', sdp: offer.sdp }, [p]);
    } catch (err) {
      console.log(`[pakchat] call offer: ${String(err)}`);
    }
  }

  private async gotOffer(c: Live, from: Device, sdp: string) {
    const p = this.find(c, from) ?? this.peer(c, from);
    const pc = await this.connection(c, p);
    if (c.done) return;
    if (pc.signalingState === 'have-local-offer') {
      // We both offered at once (both turned a camera on): the phone whose name sorts first
      // keeps its own offer, and the other takes back its own and answers this one.
      if (keyOf(core.client.device) < p.key) return;
      try {
        await pc.setLocalDescription(new RTCSessionDescription({ type: 'rollback', sdp: '' }));
      } catch {
        return;
      }
    }
    await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));
    await this.flushIce(p);
    // Ringing: say I'll send too (my mic isn't on yet; sendTracks puts it on when I answer).
    if (p.early && c.early === p) for (const t of pc.getTransceivers()) if (t.direction === 'recvonly') t.direction = 'sendrecv';
    const made = (await pc.createAnswer()) as { sdp: string; type: 'answer' };
    const answer = { type: 'answer' as const, sdp: tuneSdp(made.sdp) };
    await pc.setLocalDescription(new RTCSessionDescription(answer));
    void this.saveData(p);
    if (c.state === 'outgoing') c.state = 'connecting';
    this.emit();
    await this.send(c, { op: 'answer', sdp: answer.sdp }, [p]);
  }

  private async gotAnswer(c: Live, from: Device, sdp: string) {
    const p = this.find(c, from);
    if (!p?.pc || p.pc.signalingState !== 'have-local-offer') return;
    await p.pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp }));
    await this.flushIce(p);
  }

  private async gotIce(c: Live, from: Device, cand: NonNullable<CallSignal['cand']>) {
    const p = this.find(c, from) ?? this.peer(c, from);
    const ice = new RTCIceCandidate({ candidate: cand.candidate, sdpMid: cand.sdpMid ?? null, sdpMLineIndex: cand.sdpMLineIndex ?? null });
    if (!p.pc?.remoteDescription) {
      p.pending.push(ice);
      return;
    }
    await p.pc.addIceCandidate(ice).catch(() => {});
  }

  private async flushIce(p: Peer) {
    const list = p.pending;
    p.pending = [];
    for (const ice of list) await p.pc?.addIceCandidate(ice).catch(() => {});
  }

  private connectionChanged(c: Live, p: Peer) {
    const state = p.pc?.connectionState;
    if (c.done || !state) return;
    // Still ringing: it's ready (kept for the answer), or it's dropped quietly and the call connects the usual way.
    if (c.early === p) {
      if (state === 'connected') p.state = 'connected';
      else if (state === 'failed' || state === 'closed') {
        c.early = null;
        this.closePeer(p);
      }
      return;
    }
    if (state === 'connected') {
      p.state = 'connected';
      p.giveUp?.();
      p.giveUp = null;
      if (!c.connectedOnce) {
        c.connectedOnce = true;
        c.startedAt = Date.now();
        c.state = 'active';
        fileModule().callStopTone();
        this.ongoing(c);
        // A new group call: everyone else rings now.
        if (c.invite.length) {
          const invite = c.invite;
          c.invite = [];
          void this.add(invite);
        }
      }
    } else if (state === 'disconnected' || state === 'failed') {
      if (p.state === 'connected') p.state = 'reconnecting';
      // The phone that offered tries a new way through (a different network, the relay).
      if (state === 'failed' && keyOf(core.client.device) < p.key) void this.offer(c, p, true);
      p.giveUp ??= later(RECONNECT_MS, () => {
        if (c.done || p.state === 'connected') return;
        this.closePeer(p);
        c.peers.delete(p.key);
        this.emit();
        if (!c.peers.size) this.end(c, 'failed');
      });
    }
    this.emit();
  }

  private closePeer(p: Peer) {
    p.giveUp?.();
    p.giveUp = null;
    try {
      p.pc?.close();
    } catch {
      // Already closed.
    }
    p.pc = null;
    if (p.ownStream && p.stream) {
      const own = p.stream;
      try {
        own.release(false);
      } catch {
        // Already gone.
      }
      p.stream = null;
      p.ownStream = false;
    }
  }

  // ---- In the call ----

  setMuted(on: boolean) {
    const c = this.call;
    if (!c || c.done) return;
    c.muted = on;
    for (const t of c.localStream?.getAudioTracks() ?? []) t.enabled = !on;
    this.emit();
    void this.send(c, { op: 'media', audio: !on, video: c.camera });
  }

  /** The camera button. In a voice call, the first tap starts the camera. False if it couldn't. */
  async setCamera(on: boolean) {
    const c = this.call;
    if (!c || c.done) return false;
    // Sharing my screen: the camera waits (it comes back as I left it when sharing stops).
    if (c.sharing) {
      c.camera = on;
      this.emit();
      return true;
    }
    if (on && !c.localStream?.getVideoTracks().length) return this.addCamera(c);
    c.camera = on;
    for (const t of c.localStream?.getVideoTracks() ?? []) t.enabled = on;
    fileModule().callVideo(on);
    this.emit();
    void this.send(c, { op: 'media', audio: !c.muted, video: on });
    return true;
  }

  /** A voice call turns into a video call: the camera starts, and goes to everyone in the call. */
  private async addCamera(c: Live) {
    if (c.state !== 'active') return false;
    let track;
    try {
      const got = await mediaDevices.getUserMedia({ video: { facingMode: 'user', ...cameraSize() } });
      track = got.getVideoTracks()[0];
    } catch {
      return false;
    }
    if (!track) return false;
    const local = c.localStream;
    if (c.done || !local) {
      track.stop();
      return false;
    }
    local.addTrack(track);
    c.video = true;
    c.camera = true;
    c.front = true;
    fileModule().callVideo(true);
    this.emit();
    // Each connection gets the picture, then is set up again with it.
    for (const p of c.peers.values()) {
      if (!p.pc) continue;
      p.pc.addTrack(track, local);
      void this.offer(c, p);
    }
    void this.send(c, { op: 'media', audio: !c.muted, video: true });
    return true;
  }

  /**
   * Shares my screen instead of my camera, like WhatsApp: Android asks first
   * ("Start recording or casting?"), then everyone in the call sees my screen
   * until I stop (or stop it from Android's own alert). False if it couldn't, or I said no.
   */
  async shareScreen() {
    const c = this.call;
    if (!c || c.done || c.state !== 'active' || c.sharing || !c.localStream) return false;
    let stream: MediaStream;
    try {
      stream = await mediaDevices.getDisplayMedia({ android: screenSize() });
    } catch {
      return false;
    }
    const screen = stream.getVideoTracks()[0];
    const local = c.localStream;
    if (!screen || c.done || this.call !== c || c.sharing || !local) {
      stream.release();
      return false;
    }
    c.screenStream = stream;
    c.sharing = true;
    const camera = local.getVideoTracks()[0];
    for (const p of c.peers.values()) {
      if (!p.pc) continue;
      const sender = camera && p.pc.getSenders().find((x) => x.track?.id === camera.id);
      if (sender) void sender.replaceTrack(screen).then(() => this.saveData(p)).catch(() => {});
      else {
        // A voice call (or no camera): the screen is added, and each connection set up again with it.
        p.pc.addTrack(screen, local);
        void this.offer(c, p).then(() => this.saveData(p));
      }
    }
    if (camera) camera.enabled = false;
    // Stopped from Android's own "sharing" alert, or by Android.
    (screen as unknown as TrackEvents).addEventListener('ended', () => this.stopSharing());
    this.emit();
    void this.send(c, { op: 'media', audio: !c.muted, video: true, screen: true });
    return true;
  }

  stopSharing() {
    const c = this.call;
    const stream = c?.screenStream;
    if (!c || !stream) return;
    const screen = stream.getVideoTracks()[0];
    const local = c.localStream;
    const camera = local?.getVideoTracks()[0];
    c.screenStream = null;
    c.sharing = false;
    const swaps: Promise<unknown>[] = [];
    if (!c.done) {
      for (const p of c.peers.values()) {
        const sender = p.pc?.getSenders().find((x) => x.track?.id === screen?.id);
        if (!p.pc || !sender) continue;
        if (camera) swaps.push(sender.replaceTrack(camera).then(() => this.saveData(p)).catch(() => {}));
        else {
          p.pc.removeTrack(sender);
          void this.offer(c, p);
        }
      }
      if (camera) camera.enabled = c.camera;
      void this.send(c, { op: 'media', audio: !c.muted, video: !!camera && c.camera, screen: false });
    }
    this.emit();
    // The screen stops (and Android's "sharing" alert goes) once nobody is sent it any more.
    void Promise.all(swaps).then(() => stream.release());
  }

  /** "Use less data for calls" was switched: the call going on changes at once. */
  dataSaverChanged() {
    for (const p of this.call?.peers.values() ?? []) void this.saveData(p);
  }

  /**
   * "Use less data for calls" (Settings › Storage and data), like WhatsApp's:
   * thinner sound and a smaller, slower picture, for little mobile data. Off:
   * the phones choose as usual.
   *
   * A shared screen gets its own steady pace whichever it is: at most 20 frames
   * a second and 1.5 Mbit/s (10 and 400 kbit/s with less data), easing off both
   * size and speed a little when the network is slow, so a mid-range phone
   * keeps up and the other side sees it move smoothly instead of in jumps.
   */
  private async saveData(p: Peer) {
    const less = !!core.settings.lessDataCalls;
    const screenId = this.call?.screenStream?.getVideoTracks()[0]?.id;
    for (const sender of p.pc?.getSenders() ?? []) {
      const kind = sender.track?.kind;
      if (!kind) continue;
      const screen = !!screenId && sender.track?.id === screenId;
      try {
        const params = sender.getParameters();
        if (!params.encodings.length) continue;
        for (const e of params.encodings) {
          if (screen) {
            e.maxBitrate = less ? 400_000 : 1_500_000;
            e.maxFramerate = less ? 10 : 20;
            continue;
          }
          e.maxBitrate = less ? (kind === 'audio' ? 20_000 : 180_000) : null;
          if (kind === 'video') e.maxFramerate = less ? 15 : null;
        }
        if (screen) params.degradationPreference = 'balanced';
        await sender.setParameters(params);
      } catch (err) {
        console.log(`[pakchat] call data saver: ${String(err)}`);
      }
    }
  }

  flipCamera() {
    const c = this.call;
    const track = c?.localStream?.getVideoTracks()[0];
    if (!c || !track) return;
    c.front = !c.front;
    void track.applyConstraints({ facingMode: c.front ? 'user' : 'environment' }).catch(() => {
      // Older phones: the old way of switching.
      track._switchCamera();
    });
    this.emit();
  }

  /** Where the sound comes out (the speaker button). */
  setRoute(to: AudioRoute) {
    if (!this.call || this.call.done) return;
    fileModule().callRoute(to);
  }

  private watchAudio(c: Live) {
    const fm = fileModule();
    this.audioWatch?.remove();
    this.audioWatch = fm.addListener('callAudio', (s) => {
      if (this.call !== c) return;
      c.route = s.route;
      c.routes = s.routes;
      this.emit();
    });
    try {
      const s = fm.callAudioState();
      c.route = s.route;
      c.routes = s.routes;
    } catch {
      // Not ready yet; the listener fills it in.
    }
  }

  // ---- Ending ----

  private end(c: Live, reason: EndReason, quiet = false) {
    if (c.done) return;
    c.done = true;
    c.endReason = reason;
    c.state = 'ended';
    // Each step on its own: one that fails mustn't stop the rest, above all the
    // phone leaving call mode (callEnded), or the screen would keep going dark
    // near your hand and the "Ongoing call" alert would stay.
    const step = (what: string, work: () => void) => {
      try {
        work();
      } catch (err) {
        console.log(`[pakchat] call end: ${what}: ${String(err)}`);
      }
    };
    const fm = fileModule();
    step('call mode', () => fm.callEnded());
    step('ringing', () => fm.callStopRing(c.id));
    for (const stop of c.cancel) step('timer', stop);
    c.cancel = [];
    for (const p of c.peers.values()) step('connection', () => this.closePeer(p));
    const early = c.early;
    if (early) step('early connection', () => this.closePeer(early));
    c.early = null;
    if (c.screenStream) {
      const screen = c.screenStream;
      step('screen', () => screen.release());
      c.screenStream = null;
      c.sharing = false;
    }
    if (c.localStream) {
      const local = c.localStream;
      step('camera and mic', () => {
        for (const t of local.getTracks()) t.stop();
        local.release();
      });
      c.localStream = null;
    }
    step('sound watch', () => this.audioWatch?.remove());
    this.audioWatch = null;
    if (c.direction === 'out' && (reason === 'busy' || reason === 'declined')) fm.callTone('busy');
    else if (c.joined && !quiet) fm.callTone('ended');
    try {
      const r = JSON.parse(KV.getItemSync(RINGING) ?? 'null') as Ringing | null;
      if (r?.id === c.id) KV.removeItemSync(RINGING);
    } catch {
      // Nothing saved.
    }
    this.remember(c.id);
    if (!quiet) void this.log(c);
    // The call ended while another was waiting: that one now rings as usual.
    if (this.waiting && this.call === c) {
      const w = this.waiting;
      if (w.until - Date.now() > 3_000) {
        this.waiting = null;
        w.stop();
        const { at: _at, stop: _stop, ...r } = w;
        later(300, () => this.ring(r, r.until - Date.now(), true));
      } else this.dropWaiting(true);
    }
    this.emit();
    // In the background, the connection to the server isn't needed any more.
    core.letGoIfAway();
    // "Call ended" shows for a moment, then the screen closes.
    later(1_500, () => {
      if (this.call === c) {
        this.call = null;
        this.emit();
      }
    });
  }

  private remember(id: string) {
    this.finished = [...this.finished.filter((x) => x !== id), id].slice(-50);
  }

  /** Into the Calls tab and the chat ("Missed voice call", "Video call · 2:15"). */
  private async log(c: Live) {
    const seconds = c.startedAt ? Math.round((Date.now() - c.startedAt) / 1000) : 0;
    const missed = c.direction === 'in' && !c.joined && c.endReason !== 'elsewhere';
    if (c.endReason === 'elsewhere') return;
    const withWho = c.direction === 'in' ? [c.from] : [...c.members, ...c.extra];
    await addToLog({ id: c.id, chatId: c.chatId, with: withWho, direction: c.direction, video: c.video, group: c.group, at: Date.now() - seconds * 1000, seconds, missed });
    await core.client.noteCall(c.chatId, c.id, { by: c.from, video: c.video, group: c.group, missed, seconds }, Date.now() - seconds * 1000).catch(() => {});
    if (missed && c.endReason !== 'declined') void this.missedAlert(c.chatId, c.from, c.video, c.group);
  }

  private async logMissed(chatId: string, callId: string, from: string, video: boolean, group: boolean, at: number) {
    await addToLog({ id: callId, chatId, with: [from], direction: 'in', video, group, at, seconds: 0, missed: true });
    await core.client.noteCall(chatId, callId, { by: from, video, group, missed: true, seconds: 0 }, at).catch(() => {});
    await this.missedAlert(chatId, from, video, group);
  }

  private async missedAlert(chatId: string, from: string, video: boolean, group: boolean) {
    if (AppState.currentState === 'active') return;
    const t = words();
    const chat = await core.storage.getChat(chatId);
    const title = group && chat ? core.chatTitle(chat) : core.name(from) || t.unknownCaller;
    const count = (await missedCount(chatId)) + 1;
    await core.storage.setValue(`app:missedCalls:${chatId}`, count);
    fileModule().callMissed(
      JSON.stringify({
        chatId,
        title,
        text: count > 1 ? `${video ? t.missedVideoCall : t.missedVoiceCall} (${count})` : video ? t.missedVideoCall : t.missedVoiceCall,
        count,
        at: Date.now(),
        avatar: { ...avatarTint(group ? chatId : from), letters: initials(title) },
        words: { ringChannel: t.callsChannel, missedChannel: t.missedCallsChannel, ongoingChannel: t.ongoingCallsChannel },
      }),
    );
  }

  /** You opened the chat: its missed-call alert goes. */
  async seenMissed(chatId: string) {
    if (!(await missedCount(chatId))) return;
    await core.storage.deleteValue(`app:missedCalls:${chatId}`);
    fileModule().callDismissMissed(chatId);
  }

  // ---- Sending call messages ----

  /** To everyone in the call (or just the phones `to`), each through the chat that reaches them. */
  private async send(c: Live, signal: Omit<CallSignal, 't' | 'call'>, to?: Device[], ring = false) {
    if (!c.extra.length) return this.sendTo(c.chatId, c.id, signal, to, ring);
    const inChat = to?.filter((d) => !c.extra.includes(d.userId));
    let ok = true;
    if (!inChat) ok = await this.sendTo(c.chatId, c.id, signal, undefined, ring);
    else if (inChat.length) ok = await this.sendTo(c.chatId, c.id, signal, inChat, ring);
    for (const u of c.extra) {
      const devices = to?.filter((d) => d.userId === u);
      if (devices && !devices.length) continue;
      const chatId = await this.linkFor(c, u);
      if (!chatId) continue;
      if (!(await this.sendTo(chatId, c.id, signal, devices, ring)) && devices) ok = false;
    }
    return ok;
  }

  private async sendTo(chatId: string, call: string, signal: Omit<CallSignal, 't' | 'call'>, to?: Device[], ring = false) {
    try {
      await core.client.sendCall(chatId, { call, ...signal }, { to: to?.map((d) => ({ userId: d.userId, deviceId: d.deviceId })), ring });
      return true;
    } catch (err) {
      if (!(err instanceof OfflineError)) console.log(`[pakchat] call send: ${String(err)}`);
      return false;
    }
  }

  /** Waits (up to 10 seconds) to be connected to the server. */
  private async connected() {
    core.client.start();
    for (let i = 0; i < 200 && !core.client.isConnected; i++) await fileModule().wait(50);
    return core.client.isConnected;
  }

  /** Does `work` connected, from the background too (and lets go after if PakChat is closed). */
  private async whenConnected(work: () => Promise<unknown>) {
    if (core.client.isConnected) return work();
    await core.briefly(false, async () => {
      await work();
    });
  }

  /** The "Ongoing call" alert that keeps the call going in the background. */
  private ongoing(c: Live) {
    const t = words();
    void core.storage.getChat(c.chatId).then((chat) => {
      if (c.done) return;
      const title = chat ? core.chatTitle(chat) : '…';
      const text = c.state === 'active' ? (c.video ? t.ongoingVideoCall : t.ongoingVoiceCall) : c.direction === 'out' && c.state === 'outgoing' ? (c.ringing ? t.ringingWord : t.callingWord) : t.connectingWord;
      fileModule().callOngoing(
        JSON.stringify({
          callId: c.id,
          chatId: c.chatId,
          title,
          text,
          video: c.video,
          since: c.startedAt ?? 0,
          avatar: { ...avatarTint(c.group || !chat ? c.chatId : (core.otherPerson(chat) ?? c.chatId)), letters: initials(title) },
          words: { ringChannel: t.callsChannel, missedChannel: t.missedCallsChannel, ongoingChannel: t.ongoingCallsChannel },
        }),
      );
    });
  }
}

// ---- The Calls tab's list ----

const LOG = 'app:calls';
const LOG_MAX = 300;
const logListeners = new Set<() => void>();

export async function callLog(): Promise<CallLogEntry[]> {
  return (await core.storage.getValue<CallLogEntry[]>(LOG)) ?? [];
}

async function addToLog(e: CallLogEntry) {
  const list = (await callLog()).filter((x) => x.id !== e.id);
  await core.storage.setValue(LOG, [e, ...list].slice(0, LOG_MAX));
  for (const fn of logListeners) fn();
}

export async function clearCallLog(ids?: string[]) {
  const list = ids ? (await callLog()).filter((x) => !ids.includes(x.id)) : [];
  await core.storage.setValue(LOG, list);
  for (const fn of logListeners) fn();
}

export function onCallLog(fn: () => void) {
  logListeners.add(fn);
  return () => {
    logListeners.delete(fn);
  };
}

async function missedCount(chatId: string) {
  return (await core.storage.getValue<number>(`app:missedCalls:${chatId}`)) ?? 0;
}

export const calls = new Calls();

// ---- A tapped call alert (pakchat://call/<id>), until the root layout opens the call ----

let tapped: { id: string; answer: boolean } | null = null;
const onTap = new Set<() => void>();

export function tappedCall(id: string, answer: boolean) {
  tapped = { id, answer };
  for (const fn of onTap) fn();
}

export function takeTappedCall() {
  const t = tapped;
  tapped = null;
  return t;
}

export function watchCallTaps(fn: () => void) {
  onTap.add(fn);
  return () => {
    onTap.delete(fn);
  };
}
