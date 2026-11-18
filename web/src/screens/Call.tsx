// Call.tsx: a call on screen. A call ringing here shows as a card at the
// top right (the approved design: avatar, "PakChat voice call", Decline and
// Accept). Once answered, or calling out, the call fills the window: the
// other people's pictures (or their photos in a voice call), my own small
// picture, and the buttons. "Minimise" makes it a bar above the chat list,
// so you can keep chatting during a call.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { calls, type CallView, type EndReason, type PeerView } from '../core/calls';
import { core, openChat } from '../core/core';
import { useChat, useNow } from '../core/hooks';
import { Avatar, photoOf } from '../ui/Avatar';
import { chatTitle } from '../ui/format';
import { Icon } from '../ui/Icon';
import { toast } from '../ui/overlay';
import { tr } from '../i18n';

export function useCall(): CallView | null {
  return useSyncExternalStore(
    (fn) => calls.on(fn),
    () => calls.view(),
  );
}

/** Starts a call from a chat's header, a contact's info or the Calls tab, and says why if it can't. */
export async function startCall(chatId: string, video: boolean) {
  const r = await calls.start(chatId, video);
  if (r === 'busy') toast(tr('You\'re already on a call'));
  else if (r === 'offline') toast(tr('Couldn\'t call. Check your internet connection.'));
  else if (r === 'permission') toast(video ? tr('Allow PakChat to use your microphone and camera in the browser, then try again.') : tr('Allow PakChat to use your microphone in the browser, then try again.'));
}

export function CallLayer() {
  const call = useCall();
  if (!call) return null;
  if (call.state === 'incoming') return <Incoming call={call} />;
  if (call.small) return null;
  return <CallWindow call={call} />;
}

/** The bar above the chat list while a minimised call goes on. */
export function CallBar() {
  const call = useCall();
  const now = useNow(1000);
  if (!call || !call.small || call.state === 'incoming') return null;
  return (
    <button className="callbar" onClick={() => calls.setSmall(false)}>
      <Icon name={call.video ? 'video' : 'calls'} size={18} />
      <span className="grow ellip">{call.state === 'active' && call.startedAt ? `Ongoing call · ${timer(now - call.startedAt)}` : statusWord(call)}</span>
      <span>{tr('Return to call')}</span>
    </button>
  );
}

function useTitle(call: CallView) {
  const chat = useChat(call.chatId);
  if (call.group && chat) return chatTitle(chat);
  const other = call.direction === 'in' ? call.from : (chat?.members.find((m) => m.userId !== core.myId)?.userId ?? call.from);
  return { name: core.nameOf(other) || (chat ? chatTitle(chat) : ''), id: other };
}

function Incoming({ call }: { call: CallView }) {
  const t = useTitle(call);
  const name = typeof t === 'string' ? t : t.name;
  const id = typeof t === 'string' ? call.chatId : t.id;
  return (
    <div className="callcard pop" role="alertdialog" aria-label={`${name}, ${call.video ? 'video' : 'voice'} call`}>
      <div className="top">
        <Avatar id={id} name={name} photo={call.group ? null : photoOf(id)} group={call.group} />
        <div>
          <b className="ellip">{name}</b>
          <span className="k">{call.group ? (call.video ? tr('PakChat group video call') : tr('PakChat group voice call')) : call.video ? tr('PakChat video call') : tr('PakChat voice call')}</span>
        </div>
      </div>
      <div className="live">
        <i />
        <span>{tr('Calls are end-to-end encrypted. Only the people in this call can hear or see it.')}</span>
      </div>
      <div className="cb">
        <button className="no" onClick={() => void calls.decline()}>
          <Icon name="endCall" size={20} />{' '}{tr('Decline')}
        </button>
        <button className="yes" autoFocus onClick={() => void calls.answer()}>
          <Icon name={call.video ? 'video' : 'calls'} size={18} />{' '}{tr('Accept')}
        </button>
      </div>
    </div>
  );
}

const ENDED: Record<EndReason, string> = {
  hungUp: 'Call ended',
  theyHungUp: 'Call ended',
  declined: 'Declined',
  busy: 'On another call',
  noAnswer: 'No answer',
  missed: 'Missed call',
  failed: "Couldn't connect",
  elsewhere: 'Answered on another device',
  offline: 'No internet connection',
  full: 'This call is full',
  permission: 'Microphone not allowed',
};

function statusWord(call: CallView) {
  if (call.state === 'ended') return ENDED[call.endReason ?? 'hungUp'];
  if (call.state === 'outgoing') return call.ringing ? tr('Ringing…') : tr('Calling…');
  if (call.state === 'connecting') return 'Connecting…';
  if (call.peers.some((p) => p.state === 'reconnecting')) return 'Reconnecting…';
  return '';
}

function timer(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function CallWindow({ call }: { call: CallView }) {
  const t = useTitle(call);
  const name = typeof t === 'string' ? t : t.name;
  const id = typeof t === 'string' ? call.chatId : t.id;
  const now = useNow(1000);
  const count = call.peers.filter((p) => p.state !== 'connecting').length + 1;
  const time = call.startedAt ? timer(now - call.startedAt) : '';
  const status = statusWord(call) || (call.group && call.state === 'active' ? `${tr('{n} people', { n: count })} · ${time}` : time);
  const seeing = call.peers.filter((p) => p.video && p.stream);
  // A bigger group call with pictures: everyone in a grid that scrolls, me too.
  const many = call.group && call.peers.length > 3 && (call.video || seeing.length > 0);
  const live = call.state !== 'ended';

  // Esc makes it small; the call carries on.
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && calls.setSmall(true);
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, []);

  return (
    <div className={`callwin ${seeing.length ? 'vid' : ''}`} role="dialog" aria-label={`Call with ${name}`}>
      <div className="chead">
        <Icon name="lock" size={14} />
        <span>{tr('End-to-end encrypted')}</span>
        <div className="grow" />
        <button className="ib" aria-label={tr('Minimise')} data-tip={tr('Minimise')} onClick={() => calls.setSmall(true)}>
          <Icon name="down" size={22} />
        </button>
      </div>

      {many ? (
        <Grid call={call} />
      ) : seeing.length ? (
        <div className={`tiles n${Math.min(seeing.length, 4)}`}>
          {seeing.map((p) => (
            <Tile key={p.key} peer={p} />
          ))}
        </div>
      ) : (
        <div className="who">
          <Avatar id={id} name={name} photo={call.group ? null : photoOf(id)} group={call.group} />
          <b className="ellip">{name}</b>
          <span>{status}</span>
          {call.group && call.peers.length > 0 && (
            <div className="people">
              {call.peers.map((p) => (
                <span key={p.key} className={p.state !== 'connected' ? 'dim' : p.speaking ? 'talk' : ''}>
                  {core.nameOf(p.userId)}
                  {!p.audio && <Icon name="micOff" size={14} />}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {(many || seeing.length > 0) && (
        <div className="vstatus">
          <b>{name}</b> {status}
        </div>
      )}

      {/* Their sound, for voice calls and for people without a picture. */}
      {call.peers
        .filter((p) => p.stream && !(p.video && seeing.includes(p)))
        .map((p) => (
          <Sound key={p.key} stream={p.stream!} rev={p.rev} />
        ))}

      {call.local && !many && <Mirror stream={call.local} />}
      {call.sharing && <div className="sharing"><Icon name="screenShare" size={16} />{' '}{tr('You\'re sharing your screen')}</div>}

      {call.waiting && <Waiting w={call.waiting} />}

      <div className="cbar">
        <Round label={call.camera ? tr('Turn camera off') : tr('Turn camera on')} on={!call.camera} icon={call.camera ? 'video' : 'videoOff'} disabled={!live || (!call.video && call.state !== 'active')} run={() => void calls.setCamera(!call.camera).then((ok) => !ok && toast(tr('Couldn\'t start the camera')))} />
        <Round label={call.muted ? tr('Unmute') : tr('Mute')} on={call.muted} icon={call.muted ? 'micOff' : 'mic'} disabled={!live} run={() => calls.setMuted(!call.muted)} />
        <Round label={call.sharing ? tr('Stop sharing') : tr('Share screen')} on={call.sharing} icon="screenShare" disabled={!live || call.state !== 'active'} run={() => (call.sharing ? calls.stopSharing() : void calls.shareScreen())} />
        <Round label={tr('Go to chat')} icon="chat" run={() => (openChat(call.chatId), calls.setSmall(true))} />
        <button className="end" aria-label={tr('End call')} data-tip={tr('End call')} disabled={!live} onClick={() => void calls.hangUp()}>
          <Icon name="endCall" size={26} />
        </button>
      </div>
    </div>
  );
}

function Round({ label, icon, on, disabled, run }: { label: string; icon: Parameters<typeof Icon>[0]['name']; on?: boolean; disabled?: boolean; run: () => void }) {
  return (
    <button className={`round ${on ? 'on' : ''}`} aria-label={label} data-tip={label} aria-pressed={on} disabled={disabled} onClick={run}>
      <Icon name={icon} size={24} />
    </button>
  );
}

/** Everyone's tile; only the pictures of the tiles in view come (with more than 8 people). */
function Grid({ call }: { call: CallView }) {
  const box = useRef<HTMLDivElement>(null);
  // A tile that turns from a face into a picture is a new element, so it's watched anew.
  const keys = call.peers.map((p) => `${p.key}${p.video && p.stream ? '+' : ''}`).join(',');
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const shown = new Set<string>();
    let wait = 0;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const k = (e.target as HTMLElement).dataset.key;
          if (!k) continue;
          if (e.isIntersecting) shown.add(k);
          else shown.delete(k);
        }
        clearTimeout(wait);
        wait = window.setTimeout(() => calls.showTiles([...shown]), 150);
      },
      { root: el, rootMargin: '200px 0px' },
    );
    el.querySelectorAll<HTMLElement>('[data-key]').forEach((t) => io.observe(t));
    return () => {
      io.disconnect();
      clearTimeout(wait);
    };
  }, [keys]);
  useEffect(() => () => calls.showTiles(null), []);
  return (
    <div className="grid" ref={box}>
      {call.local && (
        <div className={`tile ${call.speaking ? 'talk' : ''}`}>
          {call.camera ? <Mirror stream={call.local} /> : <Face id={core.myId} />}
          <span className="tname">
            {tr('You')}
            {call.muted && <Icon name="micOff" size={14} />}
          </span>
        </div>
      )}
      {call.peers.map((p) => (p.video && p.stream ? <Tile key={p.key} peer={p} /> : <FaceTile key={p.key} peer={p} />))}
    </div>
  );
}

function Face({ id }: { id: string }) {
  const name = core.nameOf(id);
  return (
    <div className="face">
      <Avatar id={id} name={name} photo={photoOf(id)} />
    </div>
  );
}

function FaceTile({ peer }: { peer: PeerView }) {
  return (
    <div className={`tile ${peer.speaking ? 'talk' : ''} ${peer.state !== 'connected' ? 'dim' : ''}`} data-key={peer.key}>
      <Face id={peer.userId} />
      <Name peer={peer} />
    </div>
  );
}

function Name({ peer }: { peer: PeerView }) {
  return (
    <span className="tname">
      {core.nameOf(peer.userId)}
      {!peer.audio && <Icon name="micOff" size={14} />}
      {peer.state === 'reconnecting' && ` · ${tr('Reconnecting…')}`}
    </span>
  );
}

function Tile({ peer }: { peer: PeerView }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== peer.stream) ref.current.srcObject = peer.stream;
  }, [peer.stream, peer.rev]);
  // A shared screen shows whole, a face fills the tile; a double-click swaps them.
  const [swapped, setSwapped] = useState(false);
  const fit = peer.screen !== swapped;
  return (
    <div className={`tile ${peer.speaking ? 'talk' : ''}`} data-key={peer.key} onDoubleClick={() => setSwapped((f) => !f)}>
      <video ref={ref} autoPlay playsInline className={fit ? 'fit' : ''} />
      <Name peer={peer} />
    </div>
  );
}

function Sound({ stream, rev }: { stream: MediaStream; rev: number }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    void el.play().catch(() => {});
  }, [stream, rev]);
  return <audio ref={ref} autoPlay />;
}

function Mirror({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} className="mirror" autoPlay playsInline muted />;
}

function Waiting({ w }: { w: NonNullable<CallView['waiting']> }) {
  return (
    <div className="waiting">
      <Avatar id={w.from} name={core.nameOf(w.from)} photo={photoOf(w.from)} />
      <div className="grow">
        <b className="ellip">{core.nameOf(w.from) || 'Someone'}</b>
        <span>{w.video ? tr('Incoming video call') : tr('Incoming voice call')}</span>
      </div>
      <button className="btn red" onClick={() => void calls.declineWaiting()}>
        {tr('Decline')}
      </button>
      <button className="btn green" onClick={() => void calls.acceptWaiting()}>
        {tr('End & accept')}
      </button>
    </div>
  );
}
