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
//
// Only one call at a time. Its state lives here, outside any screen, so the
// call carries on while you look at your chats; the call screen
// (app/call.tsx) and the green bar on the chat list just show it.
import { OfflineError, type CallEvent, type CallSignal, type Chat, type Device } from '@pakchat/shared';
import { router } from 'expo-router';
import KV from 'expo-sqlite/kv-store';
import { AppState } from 'react-native';
import { mediaDevices, RTCIceCandidate, RTCPeerConnection, RTCSessionDescription, type MediaStream } from 'react-native-webrtc';

import { fileModule, type AudioRoute } from '../../modules/pakchat-signal';
import { en, ur, type Strings } from '../i18n/strings';
import { avatarTint, initials } from '../ui/kit';
import { core } from './core';
import { stopAll } from './player';

/** How long a call rings before it's "missed" (the same on both sides). */
export const RING_MS = 45_000;
/** A group call has room for this many phones. */
export const MAX_IN_CALL = 8;
/** How long to wait for the other phone after answering before giving up. */
const CONNECT_MS = 25_000;
/** How long a dropped connection may try to come back. */
const RECONNECT_MS = 15_000;

export type CallState = 'outgoing' | 'incoming' | 'connecting' | 'active' | 'ended';
export type EndReason = 'hungUp' | 'theyHungUp' | 'declined' | 'busy' | 'noAnswer' | 'missed' | 'failed' | 'elsewhere' | 'offline' | 'full' | 'permission';

/** One other phone in the call, as the screen shows it. */
export type PeerView = { key: string; userId: string; state: 'connecting' | 'connected' | 'reconnecting'; audio: boolean; video: boolean; stream: string | null };

/** The call, as the screen shows it. */
export type CallView = {
  id: string;
  chatId: string;
  group: boolean;
  /** A video call (the camera can still be switched off). */
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
  /** ICE that came before the offer or answer it belongs to. */
  pending: RTCIceCandidate[];
  /** Stops waiting for a dropped connection to come back. */
  giveUp: (() => void) | null;
};

type Live = Omit<CallView, 'peers' | 'local'> & {
  fromDevice: number;
  peers: Map<string, Peer>;
  localStream: MediaStream | null;
  /** I'm in it (I started it, or answered). */
  joined: boolean;
  /** Ever connected to anyone. */
  connectedOnce: boolean;
  /** Who said no (group calls end when everyone has). */
  declined: Set<string>;
  members: string[];
  cancel: (() => void)[];
  done: boolean;
};

/** A ringing call, kept so it survives PakChat being started by the ringing alert. */
type Ringing = { id: string; chatId: string; from: string; fromDevice: number; video: boolean; group: boolean; until: number };
const RINGING = 'call:ringing';

// ---- Small helpers ----

type PcEvents = {
  addEventListener(type: 'icecandidate', fn: (e: { candidate: RTCIceCandidate | null }) => void): void;
  addEventListener(type: 'track', fn: (e: { streams: MediaStream[] }) => void): void;
  addEventListener(type: 'connectionstatechange', fn: () => void): void;
};

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
  private audioWatch: { remove: () => void } | null = null;

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
    const { fromDevice: _f, peers, localStream, joined: _j, connectedOnce: _c, declined: _d, members: _m, cancel: _x, done: _done, ...rest } = c;
    return {
      ...rest,
      local: localStream && c.camera ? localStream.toURL() : null,
      peers: [...peers.values()].map((p) => ({ key: p.key, userId: p.userId, state: p.state, audio: p.audio, video: p.video, stream: p.stream ? p.stream.toURL() : null })),
    };
  }

  // ---- Starting a call ----

  /**
   * Calls everyone in a chat. `ready` is told the call's id as soon as it
   * exists (to open the call screen while the mic and camera start).
   */
  async start(chatId: string, video: boolean, ready?: (callId: string) => void): Promise<'started' | 'busy' | 'offline' | 'permission'> {
    if (this.call && !this.call.done) return this.call.chatId === chatId ? 'started' : 'busy';
    const chat = await core.storage.getChat(chatId);
    if (!chat || chat.kind === 'status') return 'offline';
    if (!core.client.isConnected) return 'offline';
    const me = core.client.device;
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
    });
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
    // Everyone in the chat rings; closed phones are woken for it.
    const rang = await this.send(c, { op: 'ring', video, group: c.group }, undefined, true);
    // Hung up already (before the ring got out): it's over.
    if (c.done) return 'started';
    if (!rang) {
      this.end(c, 'offline');
      return 'offline';
    }
    this.ongoing(c);
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

  private fresh(x: Pick<Live, 'id' | 'chatId' | 'group' | 'video' | 'direction' | 'state' | 'from' | 'fromDevice' | 'joined' | 'members'>): Live {
    return {
      ...x,
      startedAt: null,
      peers: new Map(),
      localStream: null,
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
        video: c.video ? { facingMode: 'user', width: 640, height: 480, frameRate: 24 } : false,
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
    if (!(await this.media(c))) return this.end(c, 'permission');
    fileModule().callAudioStart(c.video);
    this.watchAudio(c);
    if (!(await this.connected())) return this.end(c, 'offline');
    if (c.done) return;
    // Tell everyone (the caller, others in a group, and my other phones).
    if (!(await this.send(c, { op: 'join', video: c.camera, audio: true }, undefined, true))) return this.end(c, 'offline');
    this.ongoing(c);
    c.cancel.push(
      later(CONNECT_MS, () => {
        if (!c.done && !c.connectedOnce) this.end(c, 'failed');
      }),
    );
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
    const c = this.fresh({ id: r.id, chatId: r.chatId, group: r.group, video: r.video, direction: 'in', state: 'incoming', from: r.from, fromDevice: r.fromDevice, joined: false, members: [] });
    this.call = c;
    void core.storage.getChat(r.chatId).then((chat) => {
      if (chat) c.members = this.othersIn(chat);
    });
    KV.setItemSync(RINGING, JSON.stringify(r));
    if (announce) {
      void this.showRing(c);
      // Tell the caller's phone it's ringing here, so it shows "Ringing…".
      void this.whenConnected(() => this.sendTo(c.chatId, c.id, { op: 'ringing' }, [{ userId: c.from, deviceId: c.fromDevice }])).catch(() => {});
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
        avatar: { ...avatarTint(c.group ? c.chatId : c.from), letters: initials(title) },
        words: { ringChannel: t.callsChannel, missedChannel: t.missedCallsChannel, ongoingChannel: t.ongoingCallsChannel },
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

    switch (s.op) {
      case 'ring':
        if (mine || this.finished.includes(s.call) || c) return;
        return this.incoming(e, from);
      case 'ringing':
        // Their phone is ringing: "Calling…" becomes "Ringing…", with the ringing sound.
        if (!c || mine || c.direction !== 'out' || c.state !== 'outgoing' || c.ringing) return;
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
      case 'here':
        if (!c?.joined) return;
        return this.meet(c, from, s);
      case 'offer':
        if (!c?.joined || !s.sdp) return;
        return this.gotOffer(c, from, s.sdp);
      case 'answer':
        if (!c?.joined || !s.sdp) return;
        return this.gotAnswer(c, from, s.sdp);
      case 'ice':
        if (!c?.joined || !s.cand) return;
        return this.gotIce(c, from, s.cand);
      case 'media': {
        const p = c?.peers.get(keyOf(from));
        if (!p) return;
        if (s.audio !== undefined) p.audio = s.audio;
        if (s.video !== undefined) p.video = s.video;
        return this.emit();
      }
      case 'leave':
        if (!c) return;
        return this.someoneLeft(c, from);
      case 'decline':
        if (!c) return;
        if (mine) {
          // I said no on another phone.
          if (c.state === 'incoming') this.end(c, 'elsewhere');
          return;
        }
        c.declined.add(e.from);
        if (c.direction === 'out' && !c.connectedOnce && !c.peers.size && (!c.group || c.members.every((m) => c.declined.has(m)))) this.end(c, 'declined');
        return;
      case 'busy':
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
    // How long ago it was rung (by the server's clock, which phones roughly share).
    const age = Date.now() - e.at;
    const fresh = age < RING_MS - 3_000 || Math.abs(age) > 120_000;
    const left = Math.abs(age) > 120_000 ? 30_000 : Math.max(10_000, RING_MS - Math.max(0, age));
    const now = this.call && !this.call.done ? this.call : null;
    if (now) {
      // We called each other at the same moment: the call with the smaller id wins, on both phones.
      if (now.direction === 'out' && now.state === 'outgoing' && now.chatId === e.chatId && !now.group && !s.group && s.call < now.id) {
        const mineGoes = now;
        this.end(mineGoes, 'hungUp', true);
        void this.send(mineGoes, { op: 'leave' });
        this.ring({ id: s.call, chatId: e.chatId, from: e.from, fromDevice: e.fromDevice, video: !!s.video, group: !!s.group, until: Date.now() + left }, left, false);
        return this.answer();
      }
      if (now.direction === 'out' && now.state === 'outgoing' && now.chatId === e.chatId && !now.group && !s.group) return;
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
    this.ring({ id: s.call, chatId: e.chatId, from: e.from, fromDevice: e.fromDevice, video: !!s.video, group: !!s.group, until: Date.now() + left }, left, true);
  }

  private someoneJoined(c: Live, from: Device, s: CallSignal) {
    const key = keyOf(from);
    if (!c.peers.has(key) && c.peers.size >= MAX_IN_CALL - 1) {
      // The call is full: "busy" to them.
      void this.send(c, { op: 'busy' }, [from]);
      return;
    }
    // "I'm here": they connect with me (and with everyone else who answers the same).
    void this.send(c, { op: 'here', video: c.camera, audio: !c.muted }, [from]);
    this.meet(c, from, s);
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
      p = { key, userId: from.userId, deviceId: from.deviceId, pc: null, stream: null, state: 'connecting', audio: true, video: c.video, pending: [], giveUp: null };
      c.peers.set(key, p);
    }
    return p;
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
    const pc = new RTCPeerConnection({ iceServers: await this.iceServers(), bundlePolicy: 'max-bundle' });
    if (p.pc) {
      pc.close();
      return p.pc;
    }
    p.pc = pc;
    const local = c.localStream;
    if (local) for (const track of local.getTracks()) pc.addTrack(track, local);
    // (The library's own event types don't load, so these are spelled out.)
    const events = pc as unknown as PcEvents;
    events.addEventListener('icecandidate', (ev) => {
      const cand = ev.candidate;
      if (!cand || c.done) return;
      void this.send(c, { op: 'ice', cand: { candidate: cand.candidate, sdpMid: cand.sdpMid ?? null, sdpMLineIndex: cand.sdpMLineIndex ?? null } }, [p]);
    });
    events.addEventListener('track', (ev) => {
      const stream = ev.streams[0];
      if (stream) {
        p.stream = stream;
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
      const offer = (await pc.createOffer(restart ? { iceRestart: true } : {})) as { sdp: string; type: 'offer' };
      await pc.setLocalDescription(offer);
      await this.send(c, { op: 'offer', sdp: offer.sdp }, [p]);
    } catch (err) {
      console.log(`[pakchat] call offer: ${String(err)}`);
    }
  }

  private async gotOffer(c: Live, from: Device, sdp: string) {
    const p = this.peer(c, from);
    const pc = await this.connection(c, p);
    if (c.done) return;
    await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));
    await this.flushIce(p);
    const answer = (await pc.createAnswer()) as { sdp: string; type: 'answer' };
    await pc.setLocalDescription(answer);
    if (c.state === 'outgoing') c.state = 'connecting';
    this.emit();
    await this.send(c, { op: 'answer', sdp: answer.sdp }, [p]);
  }

  private async gotAnswer(c: Live, from: Device, sdp: string) {
    const p = c.peers.get(keyOf(from));
    if (!p?.pc || p.pc.signalingState !== 'have-local-offer') return;
    await p.pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp }));
    await this.flushIce(p);
  }

  private async gotIce(c: Live, from: Device, cand: NonNullable<CallSignal['cand']>) {
    const p = this.peer(c, from);
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

  setCamera(on: boolean) {
    const c = this.call;
    if (!c || c.done || !c.video) return;
    c.camera = on;
    for (const t of c.localStream?.getVideoTracks() ?? []) t.enabled = on;
    fileModule().callVideo(on);
    this.emit();
    void this.send(c, { op: 'media', audio: !c.muted, video: on });
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
    for (const stop of c.cancel) stop();
    c.cancel = [];
    for (const p of c.peers.values()) this.closePeer(p);
    if (c.localStream) {
      for (const t of c.localStream.getTracks()) t.stop();
      c.localStream.release();
      c.localStream = null;
    }
    this.audioWatch?.remove();
    this.audioWatch = null;
    const fm = fileModule();
    fm.callStopRing(c.id);
    fm.callEnded();
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
    const withWho = c.direction === 'in' ? [c.from] : c.members;
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

  private send(c: Live, signal: Omit<CallSignal, 't' | 'call'>, to?: Device[], ring = false) {
    return this.sendTo(c.chatId, c.id, signal, to, ring);
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
    for (let i = 0; i < 40 && !core.client.isConnected; i++) await fileModule().wait(250);
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
