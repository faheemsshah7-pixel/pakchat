// ContactInfo.tsx: about the person you're chatting with: photo, name, number or Gmail,
// their "about" line, photos you shared, starred messages, disappearing messages,
// and buttons to call, mute, clear, block, report or delete.
// In "Message yourself" it's about you, without calls, block or report.
import type { Message, Person } from '../chats'
import { timerLabel } from '../disappearing'
import { useT } from '../lang'
import { useProfile } from '../profiles'
import { fill } from '../strings'
import { PersonAvatar } from './Avatar'
import Icon, { type IconName } from './Icon'
import MediaGrid from './MediaGrid'

export type ChatActions = {
  mute: () => void
  clear: () => void
  remove: () => void
  block: () => void
  report: () => void
  leave: () => void
  starred: () => void // show the starred messages
  timer: () => void // change disappearing messages
}

type Props = {
  me: Person
  chatId: string
  self?: boolean // "Message yourself"
  person: Person
  messages: Message[]
  muted: boolean
  blocked: boolean
  starred: number // how many messages you starred here
  timer?: number // disappearing messages (seconds, 0 = off). Missing before the first message.
  actions: ChatActions
  onCall?: (video: boolean) => void // missing when you blocked them
  onBack: () => void
  onView: (m: Message, data: string) => void
}

export default function ContactInfo({ chatId, self, person, messages, muted, blocked, starred, timer, actions, onCall, onBack, onView }: Props) {
  const { t } = useT()
  const profile = useProfile(person.uid)
  return (
    <div className="pane info-pane">
      <header className="bar">
        <button className="icon" onClick={onBack} aria-label={t.close}>
          <Icon name="close" />
        </button>
        <h2>{t.contactInfo}</h2>
      </header>
      <div className="list">
        <div className="info-hero">
          <PersonAvatar uid={person.uid} name={person.name} size={120} />
          <h3 dir="auto">{self ? fill(t.youName, { name: person.name }) : person.name}</h3>
          <p dir="ltr">{profile?.phone ?? profile?.email ?? ''}</p>
          {onCall && (
            <div className="hero-actions">
              <button onClick={() => onCall(false)}>
                <Icon name="phone" />
                {t.voiceCall}
              </button>
              <button onClick={() => onCall(true)}>
                <Icon name="video" />
                {t.videoCall}
              </button>
            </div>
          )}
        </div>
        <section className="info-section">
          <p className="section-title">{t.about}</p>
          <p className="about-text" dir="auto">
            {profile?.about || t.defaultAbout}
          </p>
        </section>
        <MediaGrid chatId={chatId} messages={messages} onView={onView} />
        <ChatExtras starred={starred} timer={timer} actions={actions} />
        <section className="info-section actions">
          <ActionRow icon={muted ? 'bell' : 'bellOff'} label={muted ? t.unmute : t.muteNotifications} onClick={actions.mute} />
          <ActionRow icon="eraser" label={t.clearChat} onClick={actions.clear} />
          {!self && (
            <>
              <ActionRow icon="block" label={blocked ? `${t.unblock} ${person.name}` : `${t.block} ${person.name}`} onClick={actions.block} danger={!blocked} />
              <ActionRow icon="flag" label={`${t.report} ${person.name}`} onClick={actions.report} danger />
            </>
          )}
          <ActionRow icon="trash" label={t.deleteChat} onClick={actions.remove} danger />
        </section>
      </div>
    </div>
  )
}

// value: a small line under the label, like "Off" or "3".
type RowProps = { icon: IconName; label: string; value?: string; onClick: () => void; danger?: boolean }
export function ActionRow({ icon, label, value, onClick, danger }: RowProps) {
  return (
    <button className={danger ? 'row action danger' : 'row action'} onClick={onClick}>
      <Icon name={icon} />
      <span className="row-main" dir="auto">
        {label}
        {value && <small>{value}</small>}
      </span>
      {value !== undefined && <Icon name="chevronRight" size={18} />}
    </button>
  )
}

// "Starred messages" and "Disappearing messages", in both contact info and group info.
export function ChatExtras({ starred, timer, actions }: { starred: number; timer?: number; actions: ChatActions }) {
  const { t } = useT()
  return (
    <section className="info-section actions">
      <ActionRow icon="star" label={t.starredMessages} value={starred ? String(starred) : t.none} onClick={actions.starred} />
      {timer !== undefined && <ActionRow icon="timer" label={t.disappearing} value={timerLabel(timer, t)} onClick={actions.timer} />}
    </section>
  )
}
