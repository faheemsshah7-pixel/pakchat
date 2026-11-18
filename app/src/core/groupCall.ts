// groupCall.ts: a group call's sound and pictures, through our call server (LiveKit,
// deploy/livekit.yaml). calls.ts still rings, joins and hangs up with its own locked
// call messages; this is only how the sound and pictures travel.
//
// Each phone sends its mic (and camera) to the call server once, and the call server
// passes them on to everyone else in the call (phone to phone, with 32 people each
// phone would have to send 31 copies). Everything is locked on the phone first with
// the call's key (end-to-end encryption, LiveKit's frame encryption), and the key only
// travels inside the call's own locked messages (CallSignal.key), so the call server
// passes on what it can't see or hear. A track that comes unlocked is never shown.
//
// Everyone is named on the call server by their phone ("user id:device id", like the
// call messages), never by their name. Someone the call doesn't know is ignored.
import { MediaStream, type MediaStreamTrack } from '@livekit/react-native-webrtc';
import * as Crypto from 'expo-crypto';
import { registerGlobals, RNE2EEManager, RNKeyProvider } from '@livekit/react-native';
import { ConnectionState, Room, RoomEvent, Track, VideoQuality, type Participant, type RemoteParticipant, type RemoteTrack, type RemoteTrackPublication, type LocalTrackPublication } from 'livekit-client';

let globalsSet = false;

export type IceServer = { urls: string[]; username?: string; credential?: string };

export type GroupRoomEvents = {
  /** My own link to the call server. */
  state: (s: 'connected' | 'reconnecting' | 'gone') => void;
  /** Someone's phone came into the call, or left it. */
  person: (identity: string, here: boolean) => void;
  /** Their sound or picture arrived anew, or went. */
  media: (identity: string) => void;
  /** Who is talking now (my own phone's name too). */
  speaking: (identities: string[]) => void;
};

/** How big the pictures are on the screen: the call server sends a smaller copy for small tiles. */
export type TileSize = 'big' | 'medium' | 'small';

export class GroupRoom {
  private room: Room;
  private keys: RNKeyProvider;
  private streams = new Map<string, MediaStream>();
  /** Whose pictures to receive (the tiles on the screen); null: everyone's. */
  private seen: Set<string> | null = null;
  private size: TileSize = 'big';
  private camera: LocalTrackPublication | null = null;
  private closed = false;

  constructor(
    private allowed: (identity: string) => boolean,
    private on: GroupRoomEvents,
  ) {
    if (!globalsSet) {
      registerGlobals();
      globalsSet = true;
    }
    this.keys = new RNKeyProvider({});
    this.room = new Room({
      // The tiles are ours (RTCView), so the sizes are told by hand (setTiles), not measured.
      adaptiveStream: false,
      dynacast: true,
      encryption: { e2eeManager: new RNE2EEManager(this.keys) },
    });
    const r = this.room;
    r.on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => this.allowed(p.identity) && this.on.person(p.identity, true));
    r.on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
      this.dropStream(p.identity);
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

  /** Into the call's room, locked with its key. Throws if it can't. */
  async connect(url: string, token: string, key: string, iceServers: IceServer[]) {
    await this.keys.setSharedKey(key);
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

  /** Their sound and picture, as one stream for the screen (RTCView). */
  stream(identity: string): MediaStream | null {
    return this.streams.get(identity) ?? null;
  }

  /** My mic, or my camera (or my screen), sent to everyone. */
  async publish(track: MediaStreamTrack, kind: 'audio' | 'video', lessData: boolean) {
    // (The library's track and the call server's are the same thing; its types just differ.)
    const t = track as unknown as globalThis.MediaStreamTrack;
    if (kind === 'audio') {
      await this.room.localParticipant.publishTrack(t, { source: Track.Source.Microphone, dtx: true, red: true });
      return;
    }
    if (this.camera?.track) {
      await this.camera.track.replaceTrack(t, true);
      return;
    }
    this.camera = await this.room.localParticipant.publishTrack(t, {
      source: Track.Source.Camera,
      // Small copies too, so a small tile (or a weak connection) gets a small picture.
      simulcast: !lessData,
      videoEncoding: lessData ? { maxBitrate: 150_000, maxFramerate: 15 } : { maxBitrate: 600_000, maxFramerate: 24 },
      videoCodec: 'vp8',
    });
  }

  /** Sends this picture instead (my screen, or my camera again). */
  async replaceVideo(track: MediaStreamTrack) {
    if (this.camera?.track) await this.camera.track.replaceTrack(track as unknown as globalThis.MediaStreamTrack, true);
  }

  /** No picture any more (a screen shared in a voice call stops). */
  async dropVideo() {
    const pub = this.camera;
    this.camera = null;
    if (pub?.track) await this.room.localParticipant.unpublishTrack(pub.track, false);
  }

  /** Which pictures to receive (the tiles that show), and how big they are. */
  setTiles(seen: Set<string> | null, size: TileSize) {
    this.seen = seen;
    this.size = size;
    for (const p of this.room.remoteParticipants.values()) for (const pub of p.trackPublications.values()) this.choose(pub, p);
  }

  /** Subscribes to what's wanted: everyone's sound, and the pictures that show; nothing unlocked. */
  private choose(pub: RemoteTrackPublication, p: RemoteParticipant) {
    if (this.closed || !this.allowed(p.identity)) return;
    const locked = pub.isEncrypted;
    const want = locked && (pub.kind === Track.Kind.Audio || !this.seen || this.seen.has(p.identity));
    if (pub.isSubscribed !== want) pub.setSubscribed(want);
    if (want && pub.kind === Track.Kind.Video) pub.setVideoQuality(this.size === 'big' ? VideoQuality.HIGH : this.size === 'medium' ? VideoQuality.MEDIUM : VideoQuality.LOW);
  }

  private got(track: RemoteTrack, pub: RemoteTrackPublication, p: RemoteParticipant) {
    if (this.closed || !this.allowed(p.identity) || !pub.isEncrypted) return;
    let s = this.streams.get(p.identity);
    if (!s) {
      s = new MediaStream();
      this.streams.set(p.identity, s);
    }
    const mst = track.mediaStreamTrack as unknown as MediaStreamTrack;
    // One sound and one picture each: a new one takes the old one's place.
    for (const old of s.getTracks()) if (old.kind === mst.kind && old.id !== mst.id) s.removeTrack(old);
    if (!s.getTracks().some((x) => x.id === mst.id)) s.addTrack(mst);
    this.on.media(p.identity);
  }

  private lost(track: RemoteTrack, p: RemoteParticipant) {
    const s = this.streams.get(p.identity);
    if (!s) return;
    const mst = track.mediaStreamTrack as unknown as MediaStreamTrack;
    const had = s.getTracks().find((x) => x.id === mst.id);
    if (had) s.removeTrack(had);
    this.on.media(p.identity);
  }

  private dropStream(identity: string) {
    const s = this.streams.get(identity);
    this.streams.delete(identity);
    try {
      s?.release(false);
    } catch {
      // Already gone.
    }
  }

  /** Leaves the call's room (my mic and camera are the call's; they're stopped there). */
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const id of [...this.streams.keys()]) this.dropStream(id);
    void this.room.disconnect(false).catch(() => {});
    try {
      this.keys.dispose();
    } catch {
      // Already gone.
    }
  }
}

/** A new call's key: 32 random bytes, in base64. */
export function newCallKey(): string {
  const bytes = Crypto.getRandomBytes(32);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
