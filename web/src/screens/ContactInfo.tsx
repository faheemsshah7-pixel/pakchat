// ContactInfo.tsx: about the person you're chatting with: photo, name, number or Gmail,
// their "about" line, photos you shared, and buttons to call, mute, clear, block, report or delete.
import type { Message, Person } from '../chats'
import { useT } from '../lang'
import { useProfile } from '../profiles'
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
}

type Props = {
  me: Person
  chatId: string
  person: Person
  messages: Message[]
  muted: boolean
  blocked: boolean
  actions: ChatActions
  onCall?: (video: boolean) => void // missing when you blocked them
  onBack: () => void
  onView: (m: Message, data: string) => void
}

export default function ContactInfo({ chatId, person, messages, muted, blocked, actions, onCall, onBack, onView }: Props) {
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
          <h3 dir="auto">{person.name}</h3>
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
        <section className="info-section actions">
          <ActionRow icon={muted ? 'bell' : 'bellOff'} label={muted ? t.unmute : t.muteNotifications} onClick={actions.mute} />
          <ActionRow icon="eraser" label={t.clearChat} onClick={actions.clear} />
          <ActionRow icon="block" label={blocked ? `${t.unblock} ${person.name}` : `${t.block} ${person.name}`} onClick={actions.block} danger={!blocked} />
          <ActionRow icon="flag" label={`${t.report} ${person.name}`} onClick={actions.report} danger />
          <ActionRow icon="trash" label={t.deleteChat} onClick={actions.remove} danger />
        </section>
      </div>
    </div>
  )
}

export function ActionRow({ icon, label, onClick, danger }: { icon: IconName; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button className={danger ? 'row action danger' : 'row action'} onClick={onClick}>
      <Icon name={icon} />
      <span className="row-main" dir="auto">
        {label}
      </span>
    </button>
  )
}
