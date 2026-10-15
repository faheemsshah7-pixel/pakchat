// CallScreen.tsx: the screen during a call. calls.ts does the actual work; this only shows it.
//   Someone calling you: their name and photo, with Decline and Accept.
//   During a call: their picture (video calls) or photo, a timer, and three buttons:
//     camera on/off (video calls only), microphone on/off, and the red End call.
//   "Back to chats" (the arrow at the top) shrinks it to a green bar, so you can chat during a call.
import { useState } from 'react'
import { acceptCall, closeCallScreen, declineCall, hangUp, toggleCamera, toggleMic, type Call, type CallEnd } from '../calls'
import { useT } from '../lang'
import type { Strings } from '../strings'
import { duration, useNow } from '../time'
import { PersonAvatar } from './Avatar'
import Icon, { type IconName } from './Icon'

export default function CallScreen({ call }: { call: Call }) {
  const { t } = useT()
  const now = useNow(1000)
  const [small, setSmall] = useState(false)
  const status = statusText(call, now, t)
  const theirVideo = call.video && call.phase === 'connected' && !!call.remote?.getVideoTracks().length
  const myVideo = call.video && !!call.local?.getVideoTracks().length && !call.cameraOff

  // Their voice plays through this. It stays on the page even when the screen is shrunk.
  const voice = <audio ref={(el) => play(el, call.remote)} autoPlay />

  if (small && call.phase !== 'incoming') {
    return (
      <>
        {voice}
        <button className="call-bar" onClick={() => setSmall(false)}>
          <Icon name={call.video ? 'video' : 'phone'} size={16} />
          <span dir="auto">{call.peer.name}</span>
          <span>{status}</span>
          <small>{t.returnToCall}</small>
        </button>
      </>
    )
  }

  return (
    <div className={theirVideo ? 'call-screen has-video' : 'call-screen'} role="dialog" aria-label={call.video ? t.videoCall : t.voiceCall}>
      {voice}
      {theirVideo && <video className="remote-video" ref={(el) => play(el, call.remote)} autoPlay playsInline muted />}
      {/* Your own camera: big while it rings, then small in the corner. */}
      {myVideo && <video className={theirVideo ? 'local-video' : 'local-video full'} ref={(el) => play(el, call.local)} autoPlay playsInline muted />}

      <div className="call-top">
        {call.phase !== 'incoming' && call.phase !== 'ended' && (
          <button className="icon call-min" aria-label={t.minimize} title={t.minimize} onClick={() => setSmall(true)}>
            <Icon name="chevronDown" />
          </button>
        )}
        <p className="call-kind">
          <Icon name={call.video ? 'video' : 'phone'} size={14} /> {call.video ? t.videoCall : t.voiceCall}
        </p>
        {!theirVideo && <PersonAvatar uid={call.peer.uid} name={call.peer.name} size={120} />}
        <h2 dir="auto">{call.peer.name}</h2>
        <p className={call.phase === 'ended' && call.end !== 'ended' ? 'call-status problem' : 'call-status'}>{status}</p>
      </div>

      <div className="call-controls">
        {call.phase === 'incoming' ? (
          <>
            <CallButton icon="phone" label={t.decline} className="end" onClick={declineCall} />
            <CallButton icon={call.video ? 'video' : 'phone'} label={t.accept} className="accept" onClick={acceptCall} />
          </>
        ) : call.phase === 'ended' ? (
          <CallButton icon="close" label={t.close} onClick={closeCallScreen} />
        ) : (
          <>
            {call.video && (
              <CallButton icon={call.cameraOff ? 'videoOff' : 'video'} label={call.cameraOff ? t.cameraOn : t.cameraOff} pressed={call.cameraOff} onClick={toggleCamera} />
            )}
            <CallButton icon={call.micOff ? 'micOff' : 'mic'} label={call.micOff ? t.unmuteMic : t.muteMic} pressed={call.micOff} onClick={toggleMic} />
            <CallButton icon="phone" label={t.endCall} className="end" onClick={() => hangUp()} />
          </>
        )}
      </div>
    </div>
  )
}

type ButtonProps = { icon: IconName; label: string; onClick: () => void; className?: string; pressed?: boolean }

function CallButton({ icon, label, onClick, className = '', pressed }: ButtonProps) {
  return (
    <span className="call-btn-wrap">
      <button className={`call-btn ${className} ${pressed ? 'on' : ''}`} aria-label={label} aria-pressed={pressed} onClick={onClick}>
        <Icon name={icon} size={26} />
      </button>
      <small>{label}</small>
    </span>
  )
}

// Connect a sound or video stream to an <audio>/<video> on the page (only when it changed).
function play(el: HTMLMediaElement | null, stream: MediaStream | null) {
  if (el && el.srcObject !== stream) el.srcObject = stream
}

function statusText(call: Call, now: number, t: Strings) {
  const ends: Record<CallEnd, string> = {
    ended: t.callEnded,
    declined: t.callDeclined,
    busy: t.callBusy,
    noAnswer: t.callNoAnswer,
    failed: t.callFailed,
    micBlocked: t.callMicBlocked,
    cantCall: t.callCantCall,
  }
  switch (call.phase) {
    case 'calling':
      return t.calling
    case 'ringing':
      return t.ringing
    case 'incoming':
      return call.video ? t.incomingVideoCall : t.incomingVoiceCall
    case 'connecting':
      return t.connecting
    case 'connected':
      return duration((now - (call.connectedAt ?? now)) / 1000)
    case 'ended':
      return ends[call.end ?? 'ended']
  }
}
