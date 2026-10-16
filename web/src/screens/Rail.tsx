// Rail.tsx: the bar that takes you between PakChat's main parts, like WhatsApp's.
// On a computer it runs down the left edge: Chats, Calls and Status, then Archived and Starred,
// and Settings and your photo at the bottom. On a phone it sits along the bottom with just
// Chats, Status and Calls (index.css moves it and hides the rest).
import type { Person } from '../chats'
import { useT } from '../lang'
import { useAvatar, type Profile } from '../profiles'
import Avatar from './Avatar'
import Icon, { type IconName } from './Icon'

export type Tab = 'chats' | 'calls' | 'status' | 'archived' | 'starred'

type Props = {
  tab: Tab | null // the one that's lit up
  me: Person
  profile: Profile
  unreadChats: number
  missedCalls: number
  newStatus: boolean // someone posted a status you haven't seen
  archivedUnread: number
  onTab: (tab: Tab) => void
  onSettings: (section?: 'profile') => void
}

export default function Rail({ tab, me, profile, unreadChats, missedCalls, newStatus, archivedUnread, onTab, onSettings }: Props) {
  const { t } = useT()
  const photo = useAvatar(me.uid, profile.photo) // (your own profile is live, so a new photo shows at once)
  const count = (n: number) => (n > 0 ? <span className="badge">{n > 99 ? '99+' : n}</span> : null)

  function item(name: Tab, icon: IconName, label: string, mark: React.ReactNode, wide = false) {
    return (
      <button
        className={['rail-item', 'rail-' + name, tab === name && 'on', wide && 'wide-only'].filter(Boolean).join(' ')}
        aria-label={label}
        title={label}
        aria-current={tab === name ? 'page' : undefined}
        onClick={() => onTab(name)}
      >
        <span className="rail-icon">
          <Icon name={icon} />
          {mark}
        </span>
        <span className="rail-label">{label}</span>
      </button>
    )
  }

  return (
    <nav className="rail" aria-label={t.mainMenu}>
      {item('chats', 'chat', t.chatsTab, count(unreadChats))}
      {item('calls', 'phone', t.calls, count(missedCalls))}
      {item('status', 'status', t.status, newStatus ? <span className="dot" /> : null)}
      <hr className="wide-only" />
      {item('archived', 'archive', t.archived, archivedUnread > 0 ? <small className="rail-count">{archivedUnread}</small> : null, true)}
      {item('starred', 'star', t.starredMessages, null, true)}
      <span className="rail-space wide-only" />
      <button className="rail-item wide-only" aria-label={t.settings} title={t.settings} onClick={() => onSettings()}>
        <span className="rail-icon">
          <Icon name="settings" />
        </span>
      </button>
      <button className="rail-item rail-me wide-only" aria-label={t.profile} title={t.profile} onClick={() => onSettings('profile')}>
        <Avatar name={profile.name} size={30} photo={photo} />
      </button>
    </nav>
  )
}
