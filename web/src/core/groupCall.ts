// groupCall.ts: a group call's sound and pictures through our call server (LiveKit),
// the website's side of the phone's app/src/core/groupCall.ts (the full story is there).
// Each device sends once; the call server passes it on. Everything is locked in the
// browser first with the call's key (frame encryption, in a worker), which only travels
// in the call's own locked messages, so the call server can't see or hear anything.
// Pictures that come unlocked are never shown.
import { ConnectionState, ExternalE2EEKeyProvider, Room, RoomEvent, Track, VideoQuality, type LocalTrackPublication, type Participant, type RemoteParticipant, type RemoteTrack, type RemoteTrackPublication } from 'livekit-client';

export type GroupRoomEvents = {
  state: (s: 'connected' | 'reconnecting' | 'gone') => void;
  person: (identity: string, here: boolean) => void;
  media: (identity: string) => void;
  speaking: (identities: string[]) => void;
};

export type TileSize = 'big' | 'medium' | 'small';

export class GroupRoom {
  private room: Room;
  private keys = new ExternalE2EEKeyProvider();
  private worker: Worker;
  private streams = new Map<string, MediaStream>();
  private seen: Set<string> | null = null;
  private size: TileSize = 'big';
  private camera: LocalTrackPublication | null = null;
  private closed = false;

  constructor(
    private allowed: (identity: string) => boolean,
    private on: GroupRoomEvents,
  ) {
    this.worker = new Worker(new URL('livekit-client/e2ee-worker', import.meta.url), { type: 'module' });
    this.room = new Room({ adaptiveStream: false, dynacast: true, encryption: { keyProvider: this.keys, worker: this.worker } });
    const r = this.room;
    r.on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => this.allowed(p.identity) && this.on.person(p.identity, true));
    r.on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
      this.streams.delete(p.identity);
      if (this.allowed(p.identity)) this.on.person(p.identity, false);
    });
    r.on(RoomEvent.TrackPublished, (pub: RemoteTrackPublication, p: RemoteParticipant) => this.choose(pub, p));
    r.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, pub: RemoteTrackPublication, p: RemoteParticipant) => this.got(track, pub, p));
    r.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, _pub: RemoteTrackPublication, p: RemoteParticipant) => this.lost(track, p));
    r.on(RoomEvent.ActiveSpeakersChanged, (who: Participant[]) => this.on.speaking(who.map((x) => x.identity)));
    r.on(RoomEvent.Reconnecting, () => this.on.state('reconnecting'));
    r.on(RoomEvent.Reconnected, () => this.on.state('connected'));
    r.on(RoomEvent.Disconnected, () => {
      if (!this.closed) this.on.state('gone');
    });
  }

  async connect(url: string, token: string, key: string, iceServers: RTCIceServer[]) {
    await this.keys.setKey(key);
    await this.room.setE2EEEnabled(true);
    await this.room.connect(url, token, { autoSubscribe: false, rtcConfig: { iceServers } });
    if (this.closed) return;
    this.on.state('connected');
    for (const p of this.room.remoteParticipants.values()) {
      if (!this.allowed(p.identity)) continue;
      this.on.person(p.identity, true);
      for (const pub of p.trackPublications.values()) this.choose(pub, p);
    }
  }

  get connected() {
    return this.room.state === ConnectionState.Connected;
  }

  stream(identity: string): MediaStream | null {
    return this.streams.get(identity) ?? null;
  }

  async publish(track: MediaStreamTrack, kind: 'audio' | 'video') {
    if (kind === 'audio') {
      await this.room.localParticipant.publishTrack(track, { source: Track.Source.Microphone, dtx: true, red: true });
      return;
    }
    if (this.camera?.track) {
      await this.camera.track.replaceTrack(track, true);
      return;
    }
    this.camera = await this.room.localParticipant.publishTrack(track, { source: Track.Source.Camera, simulcast: true, videoEncoding: { maxBitrate: 600_000, maxFramerate: 24 }, videoCodec: 'vp8' });
  }

  async replaceVideo(track: MediaStreamTrack) {
    if (this.camera?.track) await this.camera.track.replaceTrack(track, true);
  }

  async dropVideo() {
    const pub = this.camera;
    this.camera = null;
    if (pub?.track) await this.room.localParticipant.unpublishTrack(pub.track, false);
  }

  setTiles(seen: Set<string> | null, size: TileSize) {
    this.seen = seen;
    this.size = size;
    for (const p of this.room.remoteParticipants.values()) for (const pub of p.trackPublications.values()) this.choose(pub, p);
  }

  private choose(pub: RemoteTrackPublication, p: RemoteParticipant) {
    if (this.closed || !this.allowed(p.identity)) return;
    const want = pub.isEncrypted && (pub.kind === Track.Kind.Audio || !this.seen || this.seen.has(p.identity));
    if (pub.isSubscribed !== want) pub.setSubscribed(want);
    if (want && pub.kind === Track.Kind.Video) pub.setVideoQuality(this.size === 'big' ? VideoQuality.HIGH : this.size === 'medium' ? VideoQuality.MEDIUM : VideoQuality.LOW);
  }

  private got(track: RemoteTrack, pub: RemoteTrackPublication, p: RemoteParticipant) {
    if (this.closed || !this.allowed(p.identity) || !pub.isEncrypted) return;
    // A new stream each time, so the page's <video> takes it up anew.
    const old = this.streams.get(p.identity);
    const tracks = (old?.getTracks() ?? []).filter((x) => x.kind !== track.mediaStreamTrack.kind);
    this.streams.set(p.identity, new MediaStream([...tracks, track.mediaStreamTrack]));
    this.on.media(p.identity);
  }

  private lost(track: RemoteTrack, p: RemoteParticipant) {
    const old = this.streams.get(p.identity);
    if (!old) return;
    this.streams.set(p.identity, new MediaStream(old.getTracks().filter((x) => x.id !== track.mediaStreamTrack.id)));
    this.on.media(p.identity);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.streams.clear();
    void this.room.disconnect(false).catch(() => {});
    setTimeout(() => this.worker.terminate(), 2_000);
  }
}

/** A new call's key: 32 random bytes, in base64. */
export function newCallKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
