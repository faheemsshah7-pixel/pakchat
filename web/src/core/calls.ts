// calls.ts: voice and video calls on the website, with the phone app's own
// call messages (app/src/core/calls.ts has the full story), so a computer
// and a phone can call each other, and a call rings on both.
//
// In short: the caller sends "ring" to every device in the chat. Answering
// sends "join"; everyone already in the call answers "here", and each pair
// of devices connects straight to each other (WebRTC, locked by WebRTC
// itself). "leave" hangs up, "decline" says no, "busy" means on another call,
// "media" says a mic or camera went on or off. The call messages themselves
// go locked with Signal, like any message.
//
// What the website leaves to the phone: connecting while it rings (the
// phone just connects the usual way once it's answered), call links, adding
// people to a call, and the earpiece.

import { MAX_CALL_PEOPLE, OfflineError, type CallEvent, type CallSignal, type Chat, type Device } from '@pakchat/shared';

import { chatTitle } from '../ui/format';
import { core, openChat } from './core';
import { isAppLocked } from './lock';
import { tuneSdp } from './sdp';
import { playTone, stopTone } from './tones';

/** How long a call rings before it's "missed" (the same on the phone). */
export const RING_MS = 45_000;
const CONNECT_MS = 25_000;
const RECONNECT_MS = 15_000;
const IN_CALL_OPS: readonly CallSignal['op'][] = ['join', 'here', 'offer', 'answer', 'ice', 'media'];

export type CallState = 'outgoing' | 'incoming' | 'connecting' | 'active' | 'ended';
export type EndReason = 'hungUp' | 'theyHungUp' | 'declined' | 'busy' | 'noAnswer' | 'missed' | 'failed' | 'elsewhere' | 'offline' | 'full' | 'permission';

export type PeerView = { key: string; userId: string; state: 'connecting' | 'connected' | 'reconnecting'; audio: boolean; video: boolean; screen: boolean; stream: MediaStream | null; rev: number };

export type CallView = {
  id: string;
  chatId: string;
  group: boolean;
  video: boolean;
  direction: 'in' | 'out';
  state: CallState;
  from: string;
  startedAt: number | null;
  peers: PeerView[];
  muted: boolean;
  camera: boolean;
  local: MediaStream | null;
  endReason: EndReason | null;
  ringing: boolean;
  extra: string[];
  sharing: boolean;
  /** The call window is made small (a bar above the chat list). */
  small: boolean;
  waiting: { id: string; chatId: string; from: string; video: boolean; group: boolean } | null;
};

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
  pending: RTCIceCandidateInit[];
  rev: number;
  giveUp: ReturnType<typeof setTimeout> | null;
};

type Live = Omit<CallView, 'peers' | 'local' | 'waiting'> & {
  fromDevice: number;
  peers: Map<string, Peer>;
  localStream: MediaStream | null;
  screenStream: MediaStream | null;
  joined: boolean;
  connectedOnce: boolean;
  declined: Set<string>;
  members: string[];
  links: Map<string, string>;
  timers: ReturnType<typeof setTimeout>[];
  done: boolean;
  alert: Notification | null;
};

type Ringing = { id: string; chatId: string; from: string; fromDevice: number; video: boolean; group: boolean; until: number; extra: string[] };

const keyOf = (d: Device) => `${d.userId}:${d.deviceId}`;

/** The camera's picture, about what the phone sends. */
const CAMERA = { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } };

class Calls {
  private call: Live | null = null;
  private waiting: (Ringing & { at: number; timer: ReturnType<typeof setTimeout> }) | null = null;
  private finished: string[] = [];
  private ice: { servers: RTCIceServer[]; at: number } | null = null;
  private listeners = new Set<() => void>();
  private snapshot: CallView | null = null;

  on(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private emit() {
    this.snapshot = null;
    for (const fn of this.listeners) fn();
  }

  get live() {
    return !!this.call && !this.call.done;
  }

  /** The call now, as plain data (the same object until something changes, for React). */
  view(): CallView | null {
    if (this.snapshot) return this.snapshot;
    const c = this.call;
    if (!c) return null;
    const w = this.waiting;
    this.snapshot = {
      id: c.id,
      chatId: c.chatId,
      group: c.group,
      video: c.video,
      direction: c.direction,
      state: c.state,
      from: c.from,
      startedAt: c.startedAt,
      muted: c.muted,
      camera: c.camera,
      endReason: c.endReason,
      ringing: c.ringing,
      extra: [...c.extra],
      sharing: c.sharing,
      small: c.small,
      local: c.localStream && c.camera && !c.sharing ? c.localStream : null,
      peers: [...c.peers.values()].map((p) => ({ key: p.key, userId: p.userId, state: p.state, audio: p.audio, video: p.video, screen: p.screen, stream: p.stream, rev: p.rev })),
      waiting: w && !c.done ? { id: w.id, chatId: w.chatId, from: w.from, video: w.video, group: w.group } : null,
    };
    return this.snapshot;
  }

  setSmall(on: boolean) {
    if (!this.call || this.call.small === on) return;
    this.call.small = on;
    this.emit();
  }

  // ---- Starting a call ----

  async start(chatId: string, video: boolean): Promise<'started' | 'busy' | 'offline' | 'permission'> {
    if (this.call && !this.call.done) return this.call.chatId === chatId ? 'started' : 'busy';
    const chat = await core.storage.getChat(chatId);
    if (!chat || chat.kind === 'status' || chat.kind === 'community' || chat.callLink) return 'offline';
    if (!core.client.isConnected) return 'offline';
    const me = core.client.device;
    void this.iceServers();
    const c = this.fresh({ id: crypto.randomUUID(), chatId, group: chat.kind === 'group', video, direction: 'out', state: 'outgoing', from: me.userId, fromDevice: me.deviceId, joined: true, members: othersIn(chat) });
    this.call = c;
    this.emit();
    if (!(await this.media(c))) {
      if (c.done) return 'started';
      this.end(c, 'permission');
      return 'permission';
    }
    if (!(await this.send(c, { op: 'ring', video, group: c.group }, undefined, true))) {
      if (!c.done) this.end(c, 'offline');
      return c.done && c.endReason !== 'offline' ? 'started' : 'offline';
    }
    if (c.done) return 'started';
    c.timers.push(
      setTimeout(() => {
        if (c.done || c.connectedOnce || c.peers.size) return;
        void this.send(c, { op: 'leave' }, undefined, true);
        this.end(c, 'noAnswer');
      }, RING_MS),
    );
    return 'started';
  }

  private fresh(x: Pick<Live, 'id' | 'chatId' | 'group' | 'video' | 'direction' | 'state' | 'from' | 'fromDevice' | 'joined' | 'members'> & { extra?: string[] }): Live {
    return {
      extra: [],
      links: new Map(),
      ...x,
      startedAt: null,
      peers: new Map(),
      localStream: null,
      screenStream: null,
      sharing: false,
      muted: false,
      camera: x.video,
      endReason: null,
      ringing: false,
      small: false,
      connectedOnce: false,
      declined: new Set(),
      timers: [],
      done: false,
      alert: null,
    };
  }

  /** Opens the mic (and camera). False if the browser or the person said no. */
  private async media(c: Live) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: c.video ? CAMERA : false });
      if (c.done) {
        stream.getTracks().forEach((t) => t.stop());
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

  async answer() {
    const c = this.call;
    if (!c || c.state !== 'incoming') return;
    stopTone();
    c.alert?.close();
    c.state = 'connecting';
    c.joined = true;
    this.emit();
    if (!(await this.media(c))) return this.end(c, 'permission');
    if (c.done) return;
    if (!(await this.send(c, { op: 'join', video: c.camera, audio: true }, undefined, true))) return this.end(c, 'offline');
    c.timers.push(
      setTimeout(() => {
        if (!c.done && !c.connectedOnce) this.end(c, 'failed');
      }, CONNECT_MS),
    );
  }

  async decline() {
    const c = this.call;
    if (!c || c.state !== 'incoming') return;
    this.end(c, 'declined');
    // My phone stops ringing too.
    await this.send(c, { op: 'decline' }, undefined, true);
  }

  async hangUp() {
    const c = this.call;
    if (!c || c.done) return;
    if (c.state === 'incoming') return this.decline();
    const ringing = !c.connectedOnce;
    this.end(c, 'hungUp');
    await this.send(c, { op: 'leave' }, undefined, ringing);
  }

  private ring(r: Ringing, ms: number, announce: boolean) {
    const c = this.fresh({ id: r.id, chatId: r.chatId, group: r.group, video: r.video, direction: 'in', state: 'incoming', from: r.from, fromDevice: r.fromDevice, joined: false, members: [], extra: r.extra });
    this.call = c;
    void core.storage.getChat(r.chatId).then((chat) => {
      if (chat) c.members = othersIn(chat);
    });
    if (announce) {
      playTone('ring');
      void this.alert(c);
      // The caller's screen says "Ringing…".
      void this.sendTo(c.chatId, c.id, { op: 'ringing' }, [{ userId: c.from, deviceId: c.fromDevice }]);
    }
    c.timers.push(
      setTimeout(() => {
        if (!c.done && c.state === 'incoming') this.end(c, 'missed');
      }, ms),
    );
    this.emit();
  }

  /** A computer notification for a call ringing while PakChat's tab is hidden. */
  private async alert(c: Live) {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || document.visibilityState === 'visible') return;
    const chat = await core.storage.getChat(c.chatId);
    const hide = !!core.prefs[c.chatId]?.lock || isAppLocked();
    const title = hide ? 'PakChat' : c.group && chat ? chatTitle(chat) : core.nameOf(c.from) || 'PakChat';
    const n = new Notification(title, { body: callWord(c), tag: `call-${c.id}`, icon: '/icon-192.png', requireInteraction: true });
    n.onclick = () => {
      window.focus();
      n.close();
    };
    c.alert = n;
  }

  // ---- Call waiting ----

  async declineWaiting() {
    const w = this.waiting;
    if (!w) return;
    this.dropWaiting(false);
    await addToLog({ id: w.id, chatId: w.chatId, with: [w.from], direction: 'in', video: w.video, group: w.group, at: w.at, seconds: 0, missed: true });
    await core.client.noteCall(w.chatId, w.id, { by: w.from, video: w.video, group: w.group, missed: true, seconds: 0 }, w.at).catch(() => {});
    await this.sendTo(w.chatId, w.id, { op: 'decline' }, undefined, true);
  }

  async acceptWaiting() {
    const w = this.waiting;
    if (!w) return;
    this.waiting = null;
    clearTimeout(w.timer);
    await this.hangUp();
    this.ring(w, Math.max(10_000, w.until - Date.now()), false);
    await this.answer();
  }

  private dropWaiting(missed: boolean) {
    const w = this.waiting;
    if (!w) return;
    this.waiting = null;
    clearTimeout(w.timer);
    this.remember(w.id);
    if (missed) void this.logMissed(w.chatId, w.id, w.from, w.video, w.group, w.at);
    this.emit();
  }

  // ---- Call messages ----

  onSignal(e: CallEvent) {
    void this.handle(e).catch((err: unknown) => console.warn('[pakchat] call', err));
  }

  private async handle(e: CallEvent) {
    const s = e.signal;
    const from: Device = { userId: e.from, deviceId: e.fromDevice };
    const mine = e.from === core.myId;
    if (this.finished.includes(s.call) && s.op !== 'ring') return;
    const c = this.call && this.call.id === s.call && !this.call.done ? this.call : null;

    // Someone added to a phone's call talks to me through our own chat.
    if (c && e.chatId !== c.chatId) {
      if (mine) return;
      c.links.set(e.from, e.chatId);
      if (IN_CALL_OPS.includes(s.op) && !c.members.includes(e.from) && !c.extra.includes(e.from)) {
        c.extra = [...c.extra, e.from];
        c.group = true;
        this.emit();
      }
    }

    // Call links are joined from the phone.
    if (!c && (await core.storage.getChat(e.chatId))?.callLink) return;

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
        if (!c || mine || c.direction !== 'out' || c.state !== 'outgoing' || c.ringing) return;
        c.ringing = true;
        playTone('ringing');
        return this.emit();
      case 'join':
        if (!c) return;
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
        if (!p || !c) return;
        if (s.audio !== undefined) p.audio = s.audio;
        if (s.video !== undefined) {
          p.video = s.video;
          p.screen = !!s.screen;
        }
        if (s.video && !c.video) c.video = true;
        return this.emit();
      }
      case 'leave':
        if (!c) return;
        return this.someoneLeft(c, from);
      case 'decline':
        if (!c) return;
        if (mine) {
          if (c.state === 'incoming') this.end(c, 'elsewhere');
          return;
        }
        c.declined.add(e.from);
        if (c.direction === 'out' && !c.connectedOnce && !c.peers.size && (!c.group || c.members.every((m) => c.declined.has(m)))) this.end(c, 'declined');
        return;
      case 'busy':
        if (!c || c.connectedOnce) return;
        if (c.direction === 'out' && !c.group) {
          this.end(c, 'busy');
          void this.send(c, { op: 'leave' }, undefined, true);
        } else if (c.direction === 'in' && c.joined && !c.peers.size) this.end(c, 'full');
        return;
    }
  }

  private async incoming(e: CallEvent, from: Device) {
    const s = e.signal;
    void this.iceServers();
    const age = Date.now() - e.at;
    const fresh = age < RING_MS - 3_000 || Math.abs(age) > 120_000;
    const left = Math.abs(age) > 120_000 ? 30_000 : Math.max(10_000, RING_MS - Math.max(0, age));
    const extra = (s.people ?? []).filter((u) => u !== core.myId && u !== e.from);
    const ringing: Ringing = { id: s.call, chatId: e.chatId, from: e.from, fromDevice: e.fromDevice, video: !!s.video, group: !!s.group || extra.length > 0, extra, until: Date.now() + left };
    const now = this.call && !this.call.done ? this.call : null;
    if (now) {
      // We called each other at once: the smaller id wins, on both sides.
      if (now.direction === 'out' && now.state === 'outgoing' && now.chatId === e.chatId && !now.group && !s.group) {
        if (s.call > now.id) return;
        this.end(now, 'hungUp', true);
        void this.send(now, { op: 'leave' });
        this.ring(ringing, left, false);
        return this.answer();
      }
      // Call waiting, like WhatsApp: End & accept, or Decline.
      if (fresh && !this.waiting && now.joined && now.chatId !== e.chatId) {
        const timer = setTimeout(() => this.waiting?.id === ringing.id && this.dropWaiting(true), left);
        this.waiting = { ...ringing, at: e.at, timer };
        void this.sendTo(e.chatId, s.call, { op: 'ringing' }, [from]);
        return this.emit();
      }
      await this.sendTo(e.chatId, s.call, { op: 'busy' }, [from]);
      this.remember(s.call);
      return this.logMissed(e.chatId, s.call, e.from, !!s.video, !!s.group, e.at);
    }
    if (!fresh) {
      this.remember(s.call);
      return this.logMissed(e.chatId, s.call, e.from, !!s.video, !!s.group, e.at);
    }
    this.ring(ringing, left, true);
  }

  private someoneJoined(c: Live, from: Device, s: CallSignal) {
    const key = keyOf(from);
    if (!c.peers.has(key) && c.peers.size >= MAX_CALL_PEOPLE - 1) {
      void this.send(c, { op: 'busy' }, [from]);
      return;
    }
    void this.send(c, { op: 'here', video: c.camera, audio: !c.muted }, [from]);
    this.meet(c, from, s);
  }

  private meet(c: Live, from: Device, s: CallSignal) {
    const p = this.peer(c, from);
    if (s.audio !== undefined) p.audio = s.audio;
    if (s.video !== undefined) p.video = s.video;
    if (c.state === 'outgoing') {
      c.state = 'connecting';
      stopTone();
      c.timers.push(
        setTimeout(() => {
          if (!c.done && !c.connectedOnce) this.end(c, 'failed');
        }, CONNECT_MS),
      );
    }
    this.emit();
    // The device whose name sorts first makes the offer (the same rule as the phone's).
    if (keyOf(core.client.device) < p.key && !p.pc) void this.offer(c, p);
  }

  private peer(c: Live, from: Device): Peer {
    const key = keyOf(from);
    let p = c.peers.get(key);
    if (!p) {
      p = { key, userId: from.userId, deviceId: from.deviceId, pc: null, stream: null, state: 'connecting', audio: true, video: c.video, screen: false, pending: [], rev: 0, giveUp: null };
      c.peers.set(key, p);
    }
    return p;
  }

  private someoneLeft(c: Live, from: Device) {
    if (c.state === 'incoming') {
      if (!c.group || from.userId === c.from) this.end(c, 'missed');
      return;
    }
    const p = c.peers.get(keyOf(from));
    if (p) {
      this.closePeer(p);
      c.peers.delete(p.key);
      this.emit();
    }
    if (c.extra.includes(from.userId) && ![...c.peers.values()].some((x) => x.userId === from.userId)) c.extra = c.extra.filter((u) => u !== from.userId);
    if (!c.peers.size && (c.connectedOnce || !c.group)) this.end(c, 'theyHungUp');
  }

  // ---- WebRTC ----

  private async iceServers(): Promise<RTCIceServer[]> {
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
    if (p.pc) return p.pc;
    const pc = new RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle' });
    p.pc = pc;
    const local = c.localStream;
    if (local) for (const track of local.getTracks()) pc.addTrack(track, local);
    const screen = c.screenStream?.getVideoTracks()[0];
    if (screen && local) {
      const camera = pc.getSenders().find((x) => x.track?.kind === 'video');
      if (camera) void camera.replaceTrack(screen).catch(() => {});
      else pc.addTrack(screen, local);
    }
    pc.onicecandidate = (ev) => {
      const cand = ev.candidate;
      if (!cand || c.done) return;
      void this.send(c, { op: 'ice', cand: { candidate: cand.candidate, sdpMid: cand.sdpMid ?? null, sdpMLineIndex: cand.sdpMLineIndex ?? null } }, [p]);
    };
    pc.ontrack = (ev) => {
      let stream = ev.streams[0];
      if (!stream) {
        stream = p.stream ?? new MediaStream();
        stream.addTrack(ev.track);
      }
      p.stream = stream;
      p.rev++;
      this.emit();
    };
    pc.onconnectionstatechange = () => this.connectionChanged(c, p);
    return pc;
  }

  private async offer(c: Live, p: Peer, restart = false) {
    try {
      const pc = await this.connection(c, p);
      if (c.done) return;
      const made = await pc.createOffer(restart ? { iceRestart: true } : {});
      const offer = { type: 'offer' as const, sdp: tuneSdp(made.sdp ?? '') };
      await pc.setLocalDescription(offer);
      await this.send(c, { op: 'offer', sdp: offer.sdp }, [p]);
    } catch (err) {
      console.warn('[pakchat] call offer', err);
    }
  }

  private async gotOffer(c: Live, from: Device, sdp: string) {
    const p = this.peer(c, from);
    const pc = await this.connection(c, p);
    if (c.done) return;
    if (pc.signalingState === 'have-local-offer') {
      // Both offered at once: the one whose name sorts first keeps its own.
      if (keyOf(core.client.device) < p.key) return;
      await pc.setLocalDescription({ type: 'rollback' }).catch(() => {});
    }
    await pc.setRemoteDescription({ type: 'offer', sdp });
    await this.flushIce(p);
    const made = await pc.createAnswer();
    const answer = { type: 'answer' as const, sdp: tuneSdp(made.sdp ?? '') };
    await pc.setLocalDescription(answer);
    if (c.state === 'outgoing') c.state = 'connecting';
    this.emit();
    await this.send(c, { op: 'answer', sdp: answer.sdp }, [p]);
  }

  private async gotAnswer(c: Live, from: Device, sdp: string) {
    const p = c.peers.get(keyOf(from));
    if (!p?.pc || p.pc.signalingState !== 'have-local-offer') return;
    await p.pc.setRemoteDescription({ type: 'answer', sdp });
    await this.flushIce(p);
  }

  private async gotIce(c: Live, from: Device, cand: NonNullable<CallSignal['cand']>) {
    const p = this.peer(c, from);
    const ice: RTCIceCandidateInit = { candidate: cand.candidate, sdpMid: cand.sdpMid ?? null, sdpMLineIndex: cand.sdpMLineIndex ?? null };
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
      if (p.giveUp) clearTimeout(p.giveUp);
      p.giveUp = null;
      if (!c.connectedOnce) {
        c.connectedOnce = true;
        c.startedAt = Date.now();
        c.state = 'active';
        stopTone();
      }
    } else if (state === 'disconnected' || state === 'failed') {
      if (p.state === 'connected') p.state = 'reconnecting';
      if (state === 'failed' && keyOf(core.client.device) < p.key) void this.offer(c, p, true);
      p.giveUp ??= setTimeout(() => {
        if (c.done || p.state === 'connected') return;
        this.closePeer(p);
        c.peers.delete(p.key);
        this.emit();
        if (!c.peers.size) this.end(c, 'failed');
      }, RECONNECT_MS);
    }
    this.emit();
  }

  private closePeer(p: Peer) {
    if (p.giveUp) clearTimeout(p.giveUp);
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

  /** The camera button. In a voice call, the first click starts the camera. False if it couldn't. */
  async setCamera(on: boolean) {
    const c = this.call;
    if (!c || c.done) return false;
    if (c.sharing) {
      c.camera = on;
      this.emit();
      return true;
    }
    if (on && !c.localStream?.getVideoTracks().length) return this.addCamera(c);
    c.camera = on;
    for (const t of c.localStream?.getVideoTracks() ?? []) t.enabled = on;
    this.emit();
    void this.send(c, { op: 'media', audio: !c.muted, video: on });
    return true;
  }

  private async addCamera(c: Live) {
    if (c.state !== 'active') return false;
    let track: MediaStreamTrack | undefined;
    try {
      track = (await navigator.mediaDevices.getUserMedia({ video: CAMERA })).getVideoTracks()[0];
    } catch {
      return false;
    }
    const local = c.localStream;
    if (!track || c.done || !local) {
      track?.stop();
      return false;
    }
    local.addTrack(track);
    c.video = true;
    c.camera = true;
    this.emit();
    for (const p of c.peers.values()) {
      if (!p.pc) continue;
      p.pc.addTrack(track, local);
      void this.offer(c, p);
    }
    void this.send(c, { op: 'media', audio: !c.muted, video: true });
    return true;
  }

  /** Shares this computer's screen (or a window or tab) instead of the camera. */
  async shareScreen() {
    const c = this.call;
    if (!c || c.done || c.state !== 'active' || c.sharing || !c.localStream) return false;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 20 } }, audio: false });
    } catch {
      return false;
    }
    const screen = stream.getVideoTracks()[0];
    const local = c.localStream;
    if (!screen || c.done || this.call !== c || c.sharing || !local) {
      stream.getTracks().forEach((t) => t.stop());
      return false;
    }
    c.screenStream = stream;
    c.sharing = true;
    const camera = local.getVideoTracks()[0];
    for (const p of c.peers.values()) {
      if (!p.pc) continue;
      const sender = camera && p.pc.getSenders().find((x) => x.track?.id === camera.id);
      if (sender) void sender.replaceTrack(screen).catch(() => {});
      else {
        p.pc.addTrack(screen, local);
        void this.offer(c, p);
      }
    }
    if (camera) camera.enabled = false;
    // "Stop sharing" in the browser's own bar.
    screen.addEventListener('ended', () => this.stopSharing());
    this.emit();
    void this.send(c, { op: 'media', audio: !c.muted, video: true, screen: true });
    return true;
  }

  stopSharing() {
    const c = this.call;
    const stream = c?.screenStream;
    if (!c || !stream) return;
    const screen = stream.getVideoTracks()[0];
    const camera = c.localStream?.getVideoTracks()[0];
    c.screenStream = null;
    c.sharing = false;
    if (!c.done) {
      for (const p of c.peers.values()) {
        const sender = p.pc?.getSenders().find((x) => x.track?.id === screen?.id);
        if (!p.pc || !sender) continue;
        if (camera) void sender.replaceTrack(camera).catch(() => {});
        else {
          p.pc.removeTrack(sender);
          void this.offer(c, p);
        }
      }
      if (camera) camera.enabled = c.camera;
      void this.send(c, { op: 'media', audio: !c.muted, video: !!camera && c.camera, screen: false });
    }
    stream.getTracks().forEach((t) => t.stop());
    this.emit();
  }

  // ---- Ending ----

  private end(c: Live, reason: EndReason, quiet = false) {
    if (c.done) return;
    c.done = true;
    c.endReason = reason;
    c.state = 'ended';
    stopTone();
    c.alert?.close();
    for (const t of c.timers) clearTimeout(t);
    c.timers = [];
    for (const p of c.peers.values()) this.closePeer(p);
    c.screenStream?.getTracks().forEach((t) => t.stop());
    c.screenStream = null;
    c.sharing = false;
    c.localStream?.getTracks().forEach((t) => t.stop());
    c.localStream = null;
    if (c.direction === 'out' && (reason === 'busy' || reason === 'declined')) playTone('busy');
    else if (c.joined && !quiet) playTone('ended');
    this.remember(c.id);
    if (!quiet) void this.log(c);
    // The call ended with another waiting: that one now rings as usual.
    const w = this.waiting;
    if (w && this.call === c) {
      this.waiting = null;
      clearTimeout(w.timer);
      if (w.until - Date.now() > 3_000) setTimeout(() => this.ring(w, w.until - Date.now(), true), 300);
      else void this.logMissed(w.chatId, w.id, w.from, w.video, w.group, w.at);
    }
    this.emit();
    // "Call ended" shows for a moment, then the window closes.
    setTimeout(() => {
      if (this.call === c) {
        this.call = null;
        this.emit();
      }
    }, 1_500);
  }

  private remember(id: string) {
    this.finished = [...this.finished.filter((x) => x !== id), id].slice(-50);
  }

  private async log(c: Live) {
    if (c.endReason === 'elsewhere') return;
    const seconds = c.startedAt ? Math.round((Date.now() - c.startedAt) / 1000) : 0;
    const missed = c.direction === 'in' && !c.joined;
    const withWho = c.direction === 'in' ? [c.from] : [...c.members, ...c.extra];
    const at = Date.now() - seconds * 1000;
    await addToLog({ id: c.id, chatId: c.chatId, with: withWho, direction: c.direction, video: c.video, group: c.group, at, seconds, missed });
    await core.client.noteCall(c.chatId, c.id, { by: c.from, video: c.video, group: c.group, missed, seconds }, at).catch(() => {});
    if (missed && c.endReason !== 'declined') void this.missedAlert(c.chatId, c.from, c.video, c.group);
  }

  private async logMissed(chatId: string, callId: string, from: string, video: boolean, group: boolean, at: number) {
    await addToLog({ id: callId, chatId, with: [from], direction: 'in', video, group, at, seconds: 0, missed: true });
    await core.client.noteCall(chatId, callId, { by: from, video, group, missed: true, seconds: 0 }, at).catch(() => {});
    await this.missedAlert(chatId, from, video, group);
  }

  private async missedAlert(chatId: string, from: string, video: boolean, group: boolean) {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || document.visibilityState === 'visible' || !core.settings.notifications) return;
    const chat = await core.storage.getChat(chatId);
    const locked = !!core.prefs[chatId]?.lock || isAppLocked();
    const title = locked ? 'PakChat' : group && chat ? chatTitle(chat) : core.nameOf(from) || 'PakChat';
    const n = new Notification(title, { body: video ? 'Missed video call' : 'Missed voice call', tag: `missed-${chatId}`, icon: '/icon-192.png' });
    n.onclick = () => {
      window.focus();
      openChat(chatId);
      n.close();
    };
  }

  // ---- Sending ----

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

  private async sendTo(chatId: string, call: string, signal: Omit<CallSignal, 't' | 'call'>, to?: Device[], ring = false) {
    try {
      await core.client.sendCall(chatId, { call, ...signal }, { to: to?.map((d) => ({ userId: d.userId, deviceId: d.deviceId })), ring });
      return true;
    } catch (err) {
      if (!(err instanceof OfflineError)) console.warn('[pakchat] call send', err);
      return false;
    }
  }
}

function othersIn(chat: Chat) {
  return chat.members.map((m) => m.userId).filter((id) => id !== core.myId);
}

/** "Incoming voice call", "Incoming group video call"… */
export function callWord(c: { group: boolean; video: boolean }) {
  return c.group ? (c.video ? 'Incoming group video call' : 'Incoming group voice call') : c.video ? 'Incoming video call' : 'Incoming voice call';
}

// ---- The Calls tab's list (this computer's own, like the phone's) ----

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
  return () => void logListeners.delete(fn);
}

export const calls = new Calls();
