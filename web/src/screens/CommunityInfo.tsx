// CommunityInfo.tsx: everything about one community (communities.ts): its name and description,
// its announcements, its groups (the ones you're in, and the others you can join), and who's in it.
// Admins can rename it, add groups (new ones, or groups they already look after), add and remove
// people, make other admins, and share an invite link. Anyone can leave; the owner deactivates it instead.
import { useState } from 'react'
import { findUser, type Chat, type Person } from '../chats'
import {
  addToCommunity,
  deactivateCommunity,
  describeCommunity,
  groupsToLink,
  isCommunityAdmin,
  joinCommunityGroup,
  leaveCommunity,
  linkGroups,
  newCommunityGroup,
  removeCommunityInvite,
  removeFromCommunity,
  renameCommunity,
  resetCommunityInvite,
  setCommunityAdmin,
  unlinkGroup,
  type Community,
} from '../communities'
import { inviteLink } from '../invites'
import { useT } from '../lang'
import { fill } from '../strings'
import Avatar, { GroupAvatar } from './Avatar'
import { ActionRow } from './ContactInfo'
import { PeopleDialog } from './Dialogs'
import { MemberRow } from './GroupInfo'
import Icon from './Icon'
import Modal from './Modal'
import Popover, { type PopoverItem } from './Popover'

type Props = {
  me: Person
  community: Community
  chats: Chat[] // your chats (the community's groups you're in are among them)
  people: Person[] // everyone you know (to add)
  onBack: () => void
  onOpenChat: (chatId: string) => void
  onOpenPerson: (person: Person) => void
}

export default function CommunityInfo({ me, community, chats, people, onBack, onOpenChat, onOpenPerson }: Props) {
  const { t } = useT()
  const [editing, setEditing] = useState<'name' | 'description' | null>(null)
  const [draft, setDraft] = useState('')
  const [groupName, setGroupName] = useState('')
  const [number, setNumber] = useState('')
  const [dialog, setDialog] = useState<'people' | 'groups' | null>(null)
  const [memberMenu, setMemberMenu] = useState<{ uid: string; x: number; y: number } | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const iAmAdmin = isCommunityAdmin(community, me.uid)
  const iAmOwner = community.owner === me.uid
  const nameOf = (uid: string) => community.names[uid] ?? '?'
  const announcements = chats.find((c) => c.id === community.announcementsId)
  const groupIds = Object.keys(community.groups).sort((a, b) => community.groups[a].localeCompare(community.groups[b]))
  const mine = groupIds.map((id) => chats.find((c) => c.id === id)).filter((c): c is Chat => !!c)
  const others = groupIds.filter((id) => !chats.some((c) => c.id === id))

  // Run a change, and say what went wrong if it fails.
  async function attempt(job: () => Promise<unknown>) {
    setError('')
    setBusy(true)
    try {
      await job()
    } catch (err) {
      const why = err instanceof Error ? err.message : ''
      setError(why === 'too-many' ? t.tooManyMembers : why === 'too-many-groups' ? t.tooManyGroups : t.somethingWrong)
      console.error(err)
    } finally {
      setBusy(false)
    }
  }

  function startEdit(what: 'name' | 'description') {
    setDraft((what === 'name' ? community.name : community.description) ?? '')
    setEditing(what)
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault()
    const text = draft.trim()
    if (editing === 'name' && text && text !== community.name) await attempt(() => renameCommunity(me, community, text))
    if (editing === 'description' && text !== (community.description ?? '')) await attempt(() => describeCommunity(community, text))
    setEditing(null)
  }

  async function addGroup(e: React.FormEvent) {
    e.preventDefault()
    const title = groupName.trim()
    if (!title) return
    await attempt(async () => {
      const chatId = await newCommunityGroup(me, community, title)
      setGroupName('')
      onOpenChat(chatId)
    })
  }

  async function addByNumber(e: React.FormEvent) {
    e.preventDefault()
    await attempt(async () => {
      const person = await findUser(number)
      if (!person) return setError(t.notOnPakChat)
      if (community.members.includes(person.uid)) return setError(t.alreadyIn)
      await addToCommunity(me, community, [person])
      setNumber('')
    })
  }

  async function copyLink() {
    if (!community.inviteCode) return
    await navigator.clipboard.writeText(inviteLink(community.inviteCode))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // The menu when you tap someone in the member list.
  function memberItems(uid: string): PopoverItem[] {
    const person = { uid, name: nameOf(uid) }
    const items: PopoverItem[] = [{ label: fill(t.messageName, { name: person.name }), icon: 'chatPlus', onClick: () => onOpenPerson(person) }]
    if (iAmAdmin && uid !== community.owner) {
      const admin = isCommunityAdmin(community, uid)
      items.push({ label: admin ? t.dismissAdmin : t.makeCommunityAdmin, icon: 'shield', onClick: () => attempt(() => setCommunityAdmin(community, uid, !admin)) })
      items.push({
        label: fill(t.removeName, { name: person.name }),
        icon: 'block',
        danger: true,
        onClick: () => confirm(fill(t.confirmRemoveFromCommunity, { name: person.name })) && attempt(() => removeFromCommunity(me, community, person)),
      })
    }
    return items
  }

  // Admins first, then everyone else; you at the top.
  const members = [...community.members].sort((a, b) => {
    const rank = (uid: string) => (uid === me.uid ? 0 : isCommunityAdmin(community, uid) ? 1 : 2)
    return rank(a) - rank(b) || nameOf(a).localeCompare(nameOf(b))
  })

  // (Only an admin of the group can take it out; that's checked again when it's saved.)
  const removeButton = (chatId: string) =>
    iAmAdmin && (
      <button
        className="icon small"
        aria-label={fill(t.removeGroup, { name: community.groups[chatId] })}
        title={fill(t.removeGroup, { name: community.groups[chatId] })}
        disabled={busy}
        onClick={() =>
          confirm(fill(t.confirmRemoveGroup, { name: community.groups[chatId] })) &&
          attempt(() => unlinkGroup(me.uid, community, chatId, chats.find((c) => c.id === chatId)))
        }
      >
        <Icon name="close" size={18} />
      </button>
    )

  return (
    <div className="pane info-pane community-info">
      <header className="bar">
        <button className="icon" onClick={onBack} aria-label={t.close}>
          <Icon name="close" />
        </button>
        <h2>{t.community}</h2>
      </header>

      <div className="list">
        <div className="info-hero">
          <Avatar name={community.name} community size={120} />
          {editing === 'name' ? (
            <form className="inline-edit" onSubmit={saveEdit}>
              <input dir="auto" value={draft} maxLength={50} onChange={(e) => setDraft(e.target.value)} autoFocus aria-label={t.communityName} />
              <button className="icon" aria-label={t.save} disabled={!draft.trim()}>
                <Icon name="check" />
              </button>
            </form>
          ) : (
            <h3 dir="auto">
              {community.name}
              {iAmAdmin && (
                <button className="icon small" aria-label={t.editName} onClick={() => startEdit('name')}>
                  <Icon name="edit" size={16} />
                </button>
              )}
            </h3>
          )}
          <p>{fill(t.communityLine, { n: community.members.length })}</p>
        </div>

        {(editing === 'description' || community.description || iAmAdmin) && (
          <section className="info-section">
            {editing === 'description' ? (
              <form className="inline-edit column" onSubmit={saveEdit}>
                <textarea dir="auto" value={draft} maxLength={500} rows={3} onChange={(e) => setDraft(e.target.value)} autoFocus aria-label={t.description} />
                <button className="btn small">{t.save}</button>
              </form>
            ) : community.description ? (
              <>
                <p className="section-title">
                  {t.description}
                  {iAmAdmin && (
                    <button className="icon small" aria-label={t.edit} onClick={() => startEdit('description')}>
                      <Icon name="edit" size={15} />
                    </button>
                  )}
                </p>
                <p className="about-text" dir="auto">
                  {community.description}
                </p>
              </>
            ) : (
              <button className="link" onClick={() => startEdit('description')}>
                {t.addDescription}
              </button>
            )}
          </section>
        )}

        <section className="info-section">
          <button className="row community-announcements" disabled={!announcements} onClick={() => onOpenChat(community.announcementsId)}>
            {announcements ? <GroupAvatar chat={announcements} size={44} /> : <Avatar name={community.name} list community size={44} />}
            <span className="row-main">
              <strong>{t.announcements}</strong>
              <small className="muted">{t.announcementsHint}</small>
            </span>
          </button>
        </section>

        <section className="info-section community-groups">
          {mine.length > 0 && <p className="section-title">{t.groupsYoureIn}</p>}
          {mine.map((chat) => (
            <div key={chat.id} className="row community-group">
              <button className="row-open" onClick={() => onOpenChat(chat.id)}>
                <GroupAvatar chat={chat} size={44} />
                <span className="row-main">
                  <strong dir="auto">{chat.title}</strong>
                  <small className="muted">{fill(t.members, { n: chat.members.length })}</small>
                </span>
              </button>
              {removeButton(chat.id)}
            </div>
          ))}
          {others.length > 0 && <p className="section-title">{t.otherGroups}</p>}
          {others.map((chatId) => (
            <div key={chatId} className="row community-group">
              <Avatar name={community.groups[chatId]} group size={44} />
              <strong className="row-main" dir="auto">
                {community.groups[chatId]}
              </strong>
              <button
                className="btn small"
                disabled={busy}
                aria-label={`${t.join} ${community.groups[chatId]}`}
                onClick={() =>
                  attempt(async () => {
                    await joinCommunityGroup(me, chatId)
                    onOpenChat(chatId)
                  })
                }
              >
                {t.join}
              </button>
              {removeButton(chatId)}
            </div>
          ))}
          {iAmAdmin && (
            <>
              <form className="newchat" onSubmit={addGroup}>
                <div className="field">
                  <Icon name="users" size={20} />
                  <input dir="auto" maxLength={50} placeholder={t.newCommunityGroup} aria-label={t.newCommunityGroup} value={groupName} onChange={(e) => setGroupName(e.target.value)} />
                </div>
                <button className="btn small" disabled={busy || !groupName.trim()}>
                  {t.add}
                </button>
              </form>
              <button className="row action" disabled={busy} onClick={() => setDialog('groups')}>
                <Icon name="plus" />
                <span className="row-main">{t.addExistingGroups}</span>
              </button>
            </>
          )}
        </section>

        {iAmAdmin && (
          <section className="info-section">
            <p className="section-title">{t.inviteLink}</p>
            {community.inviteCode ? (
              <div className="invite">
                <span className="invite-link" dir="ltr">
                  <Icon name="link" size={18} />
                  {inviteLink(community.inviteCode)}
                </span>
                <div className="invite-buttons">
                  <button className="btn small" onClick={copyLink}>
                    <Icon name={copied ? 'check' : 'copy'} size={16} /> {copied ? t.copied : t.copyLink}
                  </button>
                  <button className="btn small secondary" disabled={busy} onClick={() => confirm(t.confirmResetLink) && attempt(() => resetCommunityInvite(me, community))}>
                    {t.resetLink}
                  </button>
                  <button className="btn small secondary danger" disabled={busy} onClick={() => attempt(() => removeCommunityInvite(community))}>
                    {t.turnOffLink}
                  </button>
                </div>
              </div>
            ) : (
              <button className="row action" disabled={busy} onClick={() => attempt(() => resetCommunityInvite(me, community))}>
                <Icon name="link" />
                <span className="row-main">{t.makeInviteLink}</span>
              </button>
            )}
          </section>
        )}

        <section className="info-section">
          <p className="section-title">{fill(t.members, { n: community.members.length })}</p>
          {iAmAdmin && (
            <>
              <button className="row action" disabled={busy} onClick={() => setDialog('people')}>
                <Icon name="userPlus" />
                <span className="row-main">{t.addMembers}</span>
              </button>
              <form className="newchat" onSubmit={addByNumber}>
                <div className="field">
                  <Icon name="userPlus" size={20} />
                  <input dir="ltr" placeholder={t.friendsNumber} aria-label={t.friendsNumber} value={number} onChange={(e) => setNumber(e.target.value)} />
                </div>
                <button className="btn small" disabled={busy || number.trim().length < 5}>
                  {t.addMember}
                </button>
              </form>
            </>
          )}
          {error && <p className="error pad">{error}</p>}
          {members.map((uid) => (
            <MemberRow
              key={uid}
              uid={uid}
              name={uid === me.uid ? t.you : nameOf(uid)}
              photoName={nameOf(uid)}
              admin={isCommunityAdmin(community, uid)}
              onClick={
                uid === me.uid
                  ? undefined
                  : (e) => {
                      const r = e.currentTarget.getBoundingClientRect()
                      setMemberMenu({ uid, x: r.left + 60, y: r.bottom - 6 })
                    }
              }
            />
          ))}
        </section>

        <section className="info-section actions">
          {iAmOwner ? (
            <ActionRow icon="trash" label={t.deactivateCommunity} danger onClick={() => confirm(t.confirmDeactivate) && attempt(() => deactivateCommunity(community))} />
          ) : (
            <ActionRow icon="logout" label={t.leaveCommunity} danger onClick={() => confirm(t.confirmLeaveCommunity) && attempt(() => leaveCommunity(me, community, chats))} />
          )}
        </section>
      </div>

      {memberMenu && <Popover x={memberMenu.x} y={memberMenu.y} onClose={() => setMemberMenu(null)} items={memberItems(memberMenu.uid)} />}
      {dialog === 'people' && (
        <PeopleDialog
          title={t.addMembers}
          people={people.filter((p) => !community.members.includes(p.uid))}
          onDone={(uids) => uids.length > 0 && attempt(() => addToCommunity(me, community, uids.map((uid) => people.find((p) => p.uid === uid)!)))}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'groups' && <GroupsDialog groups={groupsToLink(chats, me.uid)} onDone={(picked) => picked.length > 0 && attempt(() => linkGroups(community, picked))} onClose={() => setDialog(null)} />}
    </div>
  )
}

// "Add existing groups": tick the groups (that you're an admin of) to add.
function GroupsDialog({ groups, onDone, onClose }: { groups: Chat[]; onDone: (picked: Chat[]) => void; onClose: () => void }) {
  const { t } = useT()
  const [picked, setPicked] = useState<string[]>([])
  const toggle = (id: string) => setPicked(picked.includes(id) ? picked.filter((p) => p !== id) : [...picked, id])
  return (
    <Modal title={t.addExistingGroups} onClose={onClose} className="narrow">
      <p className="hint">{t.addExistingHint}</p>
      <div className="pick-list">
        {groups.map((g) => (
          <label key={g.id} className="row pick">
            <GroupAvatar chat={g} size={42} />
            <span className="row-main">
              <strong dir="auto">{g.title}</strong>
              <small className="muted">{fill(t.members, { n: g.members.length })}</small>
            </span>
            <input type="checkbox" checked={picked.includes(g.id)} onChange={() => toggle(g.id)} />
          </label>
        ))}
        {groups.length === 0 && <p className="empty">{t.noGroupsToAdd}</p>}
      </div>
      <button
        className="btn"
        disabled={picked.length === 0}
        onClick={() => {
          onDone(groups.filter((g) => picked.includes(g.id)))
          onClose()
        }}
      >
        <Icon name="check" size={18} /> {t.done}
        {picked.length > 0 && <span className="count">{picked.length}</span>}
      </button>
    </Modal>
  )
}
