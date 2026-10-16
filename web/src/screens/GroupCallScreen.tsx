// GroupCallScreen.tsx: the screen during a group call. groupCalls.ts does the work; this only shows it.
//   Ringing: the group's photo and name, who's calling, with Decline and Join.
//   In the call: everyone in a grid of tiles: their picture, or their photo when there's no picture,
//   with their name (and a crossed-out microphone if they muted). Someone sharing their screen gets
//   the big space at the top. The buttons: camera (video calls), microphone, Share screen (computers), Leave.
//   "Back to chats" shrinks it to the green bar at the top, as in a one-to-one call.
import { useState } from 'react'
import type { Chat } from '../chats'
import { LEVEL, useBack } from '../back'
import {
  answerGroupCall,
  closeGroupCallScreen,
  declineGroupCall,
  leaveGroupCall,
  toggleGroupCamera,
  toggleGroupMic,
  toggleGroupShare,
  type GroupCall,
  type GroupCallEnd,
  type Peer,
} from '../groupCalls'
import { useT } from '../lang'
import { play } from '../rtc'
import { fill, type Strings } from '../strings'
import { duration, useNow } from '../time'
import Avatar, { GroupAvatar, PersonAvatar } from './Avatar'
import { CallButton } from './CallScreen'
import Icon from './Icon'

export default function GroupCallScreen({ call, chat }: { call: GroupCall; chat?: Chat }) {
  const { t } = useT()
  const now = useNow(1000)
  const [small, setSmall] = useState(false)
  useBack(!small, LEVEL.cover, () => call.phase !== 'incoming' && setSmall(true))
  const status = statusText(call, now, t)
  const kind = call.video ? t.groupVideoCall : t.groupVoiceCall

  // Everyone's voice. It stays on the page even when the screen is shrunk.
  const voices = call.peers.map((p) => <audio key={p.uid} ref={(el) => play(el, p.stream)} autoPlay />)

  if (small && call.phase !== 'incoming') {
    return (
      <>
        {voices}
        <button className="call-bar" onClick={() => setSmall(false)}>
          <Icon name={call.video ? 'video' : 'phone'} size={16} />
          <span dir="auto">{call.title}</span>
          <span>{status}</span>
          <small>{t.returnToCall}</small>
        </button>
      </>
    )
  }

  if (call.phase === 'incoming' || call.phase === 'ended') {
    return (
      <div className="call-screen" role="dialog" aria-label={kind}>
        <div className="call-top">
          <p className="call-kind">
            <Icon name={call.video ? 'video' : 'phone'} size={14} /> {kind}
          </p>
          {chat ? <GroupAvatar chat={chat} size={120} /> : <Avatar name={call.title} group size={120} />}
          <h2 dir="auto">{call.title}</h2>
          <p className={call.phase === 'ended' && call.end !== 'ended' ? 'call-status problem' : 'call-status'}>{status}</p>
        </div>
        <div className="call-controls">
          {call.phase === 'incoming' ? (
            <>
              <CallButton icon="phone" label={t.decline} className="end" onClick={declineGroupCall} />
              <CallButton icon={call.video ? 'video' : 'phone'} label={t.join} className="accept" onClick={answerGroupCall} />
            </>
          ) : (
            <CallButton icon="close" label={t.close} onClick={closeGroupCallScreen} />
          )}
        </div>
      </div>
    )
  }

  // Someone sharing their screen goes in the big space at the top.
  const sharer = call.peers.find((p) => p.theirs.sharing && hasPicture(p))
  const others = call.peers.filter((p) => p !== sharer)
  const myPicture = call.screen ?? (call.video && !call.cameraOff && call.local?.getVideoTracks().length ? call.local : null)
  return (
    <div className="call-screen group-call" role="dialog" aria-label={kind}>
      {voices}
      <div className="gc-head">
        <button className="icon call-min" aria-label={t.minimize} title={t.minimize} onClick={() => setSmall(true)}>
          <Icon name="chevronDown" />
        </button>
        <span className="gc-title">
          <strong dir="auto">{call.title}</strong>
          <small className="call-status">{status}</small>
        </span>
      </div>
      {(call.screen || sharer) && (
        <p className="call-sharing">
          <Icon name="screen" size={16} /> {call.screen ? t.youreSharing : fill(t.theyreSharing, { name: sharer!.name })}
        </p>
      )}

      {sharer && (
        <div className="gc-spotlight">
          <video ref={(el) => play(el, sharer.stream)} autoPlay playsInline muted />
        </div>
      )}
      <div className="gc-grid" data-count={Math.min(others.length + 1, 9)}>
        <Tile uid={call.me.uid} name={call.me.name} label={t.you} picture={myPicture} micOff={call.micOff} mirror={!call.screen} />
        {others.map((p) => (
          <Tile key={p.uid} uid={p.uid} name={p.name} picture={hasPicture(p) ? p.stream : null} micOff={p.theirs.micOff} connecting={!p.connected} />
        ))}
      </div>

      <div className="call-controls">
        {call.video && (
          <CallButton
            icon={call.cameraOff ? 'videoOff' : 'video'}
            label={call.cameraOff ? t.cameraOn : t.cameraOff}
            pressed={call.cameraOff}
            onClick={toggleGroupCamera}
          />
        )}
        <CallButton icon={call.micOff ? 'micOff' : 'mic'} label={call.micOff ? t.unmuteMic : t.muteMic} pressed={call.micOff} onClick={toggleGroupMic} />
        {call.canShare && <CallButton icon="screen" label={call.screen ? t.stopScreen : t.shareScreen} pressed={!!call.screen} onClick={toggleGroupShare} />}
        <CallButton icon="phone" label={t.leaveCall} className="end" onClick={leaveGroupCall} />
      </div>
    </div>
  )
}

// Does their tile show a picture? Their screen, or their camera in a video call (unless it's off).
function hasPicture(p: Peer) {
  return p.connected && !!p.stream?.getVideoTracks().length && (p.theirs.sharing || !p.theirs.cameraOff)
}

type TileProps = { uid: string; name: string; label?: string; picture: MediaStream | null; micOff: boolean; connecting?: boolean; mirror?: boolean }

// One person in the call. (label: what it says on it, "You" on yours)
function Tile({ uid, name, label = name, picture, micOff, connecting, mirror }: TileProps) {
  const { t } = useT()
  return (
    <div className={connecting ? 'gc-tile connecting' : 'gc-tile'}>
      {picture ? (
        <video className={mirror ? 'mirror' : undefined} ref={(el) => play(el, picture)} autoPlay playsInline muted />
      ) : (
        <PersonAvatar uid={uid} name={name} size={72} />
      )}
      <span className="gc-name">
        {micOff && <Icon name="micOff" size={14} />}
        <span dir="auto">{label}</span>
        {connecting && <small>{t.connecting}</small>}
      </span>
    </div>
  )
}

function statusText(call: GroupCall, now: number, t: Strings) {
  const ends: Record<GroupCallEnd, string> = { ended: t.callEnded, full: t.callFull, failed: t.callFailed, micBlocked: t.callMicBlocked }
  switch (call.phase) {
    case 'incoming':
      return fill(t.groupCalling, { name: call.by.name })
    case 'joining':
      return t.connecting
    case 'in':
      return call.peers.length === 0 ? t.waitingForOthers : duration((now - (call.joinedAt ?? now)) / 1000)
    case 'ended':
      return ends[call.end ?? 'ended']
  }
}
