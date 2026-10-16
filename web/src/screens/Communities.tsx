// Communities.tsx: the Communities tab (communities.ts).
//   CommunityList:    on the left, your communities. Each shows its announcements and the groups of it
//                     you're in. Tap its name (or "View all") to see everything about it (CommunityInfo.tsx).
//   CommunitiesHome:  on the right, what a community is, until you pick one.
import { previewText, type Chat, type Person } from '../chats'
import type { Community } from '../communities'
import { useT } from '../lang'
import Avatar, { GroupAvatar } from './Avatar'
import Icon from './Icon'

type ListProps = {
  me: Person
  communities: Community[]
  chats: Chat[]
  activeId: string | null // the community open on the right
  onSelect: (id: string) => void
  onNew: () => void
  onOpenChat: (chatId: string) => void
}

export function CommunityList({ me, communities, chats, activeId, onSelect, onNew, onOpenChat }: ListProps) {
  const { t } = useT()
  return (
    <div className="pane communities-pane">
      <header className="bar">
        <h2>{t.communities}</h2>
        <button className="icon" aria-label={t.newCommunity} title={t.newCommunity} onClick={onNew}>
          <Icon name="plus" />
        </button>
      </header>

      <div className="list">
        <button className="row new-group" onClick={onNew}>
          <span className="avatar accent square">
            <Icon name="community" />
          </span>
          <strong className="row-main">{t.newCommunity}</strong>
        </button>

        {communities.map((c) => {
          const announcements = chats.find((chat) => chat.id === c.announcementsId)
          // The community's groups you're in (your chat list has only the chats you're in).
          const mine = chats.filter((chat) => chat.id in c.groups)
          return (
            <section key={c.id} className="community-card">
              <button className={c.id === activeId ? 'row community-head active' : 'row community-head'} onClick={() => onSelect(c.id)}>
                <Avatar name={c.name} community size={48} />
                <strong className="row-main" dir="auto">
                  {c.name}
                </strong>
              </button>
              {announcements && <GroupRow me={me} chat={announcements} title={t.announcements} onOpen={() => onOpenChat(announcements.id)} />}
              {mine.map((chat) => (
                <GroupRow key={chat.id} me={me} chat={chat} title={chat.title ?? ''} onOpen={() => onOpenChat(chat.id)} />
              ))}
              <button className="row community-more" onClick={() => onSelect(c.id)}>
                <Icon name="chevronRight" size={18} />
                <span className="row-main">{t.viewAll}</span>
              </button>
            </section>
          )
        })}
        {communities.length === 0 && <p className="empty">{t.noCommunities}</p>}
      </div>
    </div>
  )
}

// One of a community's chats, with its newest message underneath.
function GroupRow({ me, chat, title, onOpen }: { me: Person; chat: Chat; title: string; onOpen: () => void }) {
  const { t } = useT()
  return (
    <button className="row community-group" onClick={onOpen}>
      <GroupAvatar chat={chat} size={36} />
      <span className="row-main">
        <strong dir="auto">{title}</strong>
        <small className="muted" dir="auto">
          {chat.lastMessage ? previewText(chat, me.uid, t) : ''}
        </small>
      </span>
    </button>
  )
}

export function CommunitiesHome({ onNew }: { onNew: () => void }) {
  const { t } = useT()
  return (
    <div className="pane welcome communities-home">
      <div className="glow">
        <span className="avatar accent square big">
          <Icon name="community" size={54} />
        </span>
      </div>
      <h2>{t.communitiesTitle}</h2>
      <p>{t.communitiesIntro}</p>
      <button className="btn soft" onClick={onNew}>
        <Icon name="plus" size={18} /> {t.newCommunity}
      </button>
    </div>
  )
}
