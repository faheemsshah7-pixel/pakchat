// GroupInfo.tsx: about a group: photo, name, description, photos shared, settings,
// invite link, and who's in it. Admins can change the group's info, add and remove people,
// and make others admin. Anyone can message a member, mute the group, or leave.
import { useRef, useState } from 'react'
import { findUser, isAdmin, type Chat, type Message, type Person } from '../chats'
import { addMember, removeMember, renameGroup, setAdmin, setDescription, setGroupPhoto, setOnlyAdmins } from '../groups'
import { inviteLink, removeInvite, resetInvite } from '../invites'
import { useT } from '../lang'
import { shrinkAvatar } from '../media'
import { isMuted, type ChatPrefs } from '../prefs'
import { useProfile } from '../profiles'
import { fill } from '../strings'
import { GroupAvatar, PersonAvatar } from './Avatar'
import { ActionRow, type ChatActions } from './ContactInfo'
import Icon from './Icon'
import MediaGrid from './MediaGrid'
import Popover, { type PopoverItem } from './Popover'
import Switch from './Switch'

type Props = {
  me: Person
  chat: Chat
  messages: Message[]
  prefs: ChatPrefs | undefined
  actions: ChatActions
  onBack: () => void
  onOpenPerson: (person: Person) => void
  onView: (m: Message, data: string) => void
}

export default function GroupInfo({ me, chat, messages, prefs, actions, onBack, onOpenPerson, onView }: Props) {
  const { t } = useT()
  const [number, setNumber] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<'title' | 'description' | null>(null)
  const [draft, setDraft] = useState('')
  const [memberMenu, setMemberMenu] = useState<{ uid: string; x: number; y: number } | null>(null)
  const [copied, setCopied] = useState(false)
  const photoInput = useRef<HTMLInputElement>(null)
  const iAmAdmin = isAdmin(chat, me.uid)
  const muted = isMuted(prefs)

  // Run a change, and show "Something went wrong" if it fails.
  async function attempt(job: () => Promise<unknown>) {
    setError('')
    setBusy(true)
    try {
      await job()
    } catch (err) {
      setError(t.somethingWrong)
      console.error(err)
    } finally {
      setBusy(false)
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault()
    await attempt(async () => {
      const person = await findUser(number)
      if (!person) return setError(t.notOnPakChat)
      if (chat.members.includes(person.uid)) return setError(t.alreadyIn)
      await addMember(me, chat, person)
      setNumber('')
    })
  }

  function startEdit(what: 'title' | 'description') {
    setDraft((what === 'title' ? chat.title : chat.description) ?? '')
    setEditing(what)
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault()
    const text = draft.trim()
    if (editing === 'title' && text && text !== chat.title) await attempt(() => renameGroup(me, chat, text))
    if (editing === 'description' && text !== (chat.description ?? '')) await attempt(() => setDescription(me, chat, text))
    setEditing(null)
  }

  async function pickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) await attempt(async () => setGroupPhoto(me, chat, await shrinkAvatar(file)))
  }

  async function copyLink() {
    if (!chat.inviteCode) return
    await navigator.clipboard.writeText(inviteLink(chat.inviteCode))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // The menu when you tap someone in the member list.
  function memberItems(uid: string): PopoverItem[] {
    const person = { uid, name: chat.names[uid] ?? '?' }
    const items: PopoverItem[] = [{ label: fill(t.messageName, { name: person.name }), icon: 'chatPlus', onClick: () => onOpenPerson(person) }]
    if (iAmAdmin && uid !== chat.admin) {
      const admin = chat.admins?.includes(uid)
      items.push({
        label: admin ? t.dismissAdmin : t.makeAdmin,
        icon: 'shield',
        onClick: () => attempt(() => setAdmin(chat, uid, !admin)),
      })
      items.push({
        label: fill(t.removeName, { name: person.name }),
        icon: 'block',
        danger: true,
        onClick: () => confirm(fill(t.confirmRemove, { name: person.name })) && attempt(() => removeMember(me, chat, person)),
      })
    }
    return items
  }

  // Admins first, then everyone else; you at the top.
  const members = [...chat.members].sort((a, b) => {
    const rank = (uid: string) => (uid === me.uid ? 0 : isAdmin(chat, uid) ? 1 : 2)
    return rank(a) - rank(b) || (chat.names[a] ?? '').localeCompare(chat.names[b] ?? '')
  })

  return (
    <div className="pane info-pane">
      <header className="bar">
        <button className="icon" onClick={onBack} aria-label={t.close}>
          <Icon name="close" />
        </button>
        <h2>{t.groupInfo}</h2>
      </header>

      <div className="list">
        <div className="info-hero">
          <div className="hero-photo">
            <GroupAvatar chat={chat} size={120} />
            {iAmAdmin && (
              <>
                <button className="photo-edit" aria-label={t.changePhoto} title={t.changePhoto} onClick={() => photoInput.current?.click()}>
                  <Icon name="camera" size={20} />
                </button>
                <input ref={photoInput} type="file" accept="image/*" hidden onChange={pickPhoto} />
              </>
            )}
          </div>
          {editing === 'title' ? (
            <form className="inline-edit" onSubmit={saveEdit}>
              <input dir="auto" value={draft} maxLength={50} onChange={(e) => setDraft(e.target.value)} autoFocus aria-label={t.groupName} />
              <button className="icon" aria-label={t.save} disabled={!draft.trim()}>
                <Icon name="check" />
              </button>
            </form>
          ) : (
            <h3 dir="auto">
              {chat.title}
              {iAmAdmin && (
                <button className="icon small" aria-label={t.editName} onClick={() => startEdit('title')}>
                  <Icon name="edit" size={16} />
                </button>
              )}
            </h3>
          )}
          <p>{fill(t.groupMembers, { n: chat.members.length })}</p>
          {iAmAdmin && chat.photoId && (
            <button className="link" onClick={() => attempt(() => setGroupPhoto(me, chat, null))}>
              {t.removePhoto}
            </button>
          )}
        </div>

        <section className="info-section">
          {editing === 'description' ? (
            <form className="inline-edit column" onSubmit={saveEdit}>
              <textarea dir="auto" value={draft} maxLength={500} rows={3} onChange={(e) => setDraft(e.target.value)} autoFocus aria-label={t.description} />
              <button className="btn small">{t.save}</button>
            </form>
          ) : chat.description ? (
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
                {chat.description}
              </p>
            </>
          ) : (
            iAmAdmin && (
              <button className="link" onClick={() => startEdit('description')}>
                {t.addDescription}
              </button>
            )
          )}
        </section>

        <MediaGrid chatId={chat.id} messages={messages} onView={onView} />

        {iAmAdmin && (
          <section className="info-section">
            <p className="section-title">{t.groupSettings}</p>
            <Switch label={t.onlyAdminsSetting} hint={t.onlyAdminsHint} on={!!chat.onlyAdmins} disabled={busy} onChange={(on) => attempt(() => setOnlyAdmins(me, chat, on))} />
            <p className="section-title">{t.inviteLink}</p>
            {chat.inviteCode ? (
              <div className="invite">
                <span className="invite-link" dir="ltr">
                  <Icon name="link" size={18} />
                  {inviteLink(chat.inviteCode)}
                </span>
                <div className="invite-buttons">
                  <button className="btn small" onClick={copyLink}>
                    <Icon name={copied ? 'check' : 'copy'} size={16} /> {copied ? t.copied : t.copyLink}
                  </button>
                  <button className="btn small secondary" disabled={busy} onClick={() => confirm(t.confirmResetLink) && attempt(() => resetInvite(me, chat))}>
                    {t.resetLink}
                  </button>
                  <button className="btn small secondary danger" disabled={busy} onClick={() => attempt(() => removeInvite(chat))}>
                    {t.turnOffLink}
                  </button>
                </div>
              </div>
            ) : (
              <button className="row action" disabled={busy} onClick={() => attempt(() => resetInvite(me, chat))}>
                <Icon name="link" />
                <span className="row-main">{t.makeInviteLink}</span>
              </button>
            )}
          </section>
        )}

        <section className="info-section">
          <p className="section-title">{fill(t.members, { n: chat.members.length })}</p>
          {iAmAdmin && (
            <form className="newchat" onSubmit={add}>
              <div className="field">
                <Icon name="userPlus" size={20} />
                <input dir="ltr" placeholder={t.friendsNumber} value={number} onChange={(e) => setNumber(e.target.value)} />
              </div>
              <button className="btn small" disabled={busy || number.trim().length < 5}>
                {t.addMember}
              </button>
            </form>
          )}
          {error && <p className="error pad">{error}</p>}
          {members.map((uid) => (
            <MemberRow
              key={uid}
              uid={uid}
              name={uid === me.uid ? t.you : (chat.names[uid] ?? '?')}
              photoName={chat.names[uid] ?? '?'}
              admin={isAdmin(chat, uid)}
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
          <ActionRow icon={muted ? 'bell' : 'bellOff'} label={muted ? t.unmute : t.muteNotifications} onClick={actions.mute} />
          <ActionRow icon="eraser" label={t.clearChat} onClick={actions.clear} />
          <ActionRow icon="logout" label={t.leaveGroup} onClick={actions.leave} danger />
          <ActionRow icon="flag" label={t.reportGroup} onClick={actions.report} danger />
        </section>
      </div>

      {memberMenu && <Popover x={memberMenu.x} y={memberMenu.y} onClose={() => setMemberMenu(null)} items={memberItems(memberMenu.uid)} />}
    </div>
  )
}

type MemberProps = { uid: string; name: string; photoName: string; admin: boolean; onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void }

function MemberRow({ uid, name, photoName, admin, onClick }: MemberProps) {
  const { t } = useT()
  const profile = useProfile(uid)
  return (
    <button className="row" onClick={onClick} disabled={!onClick}>
      <PersonAvatar uid={uid} name={photoName} size={44} />
      <span className="row-main">
        <strong dir="auto">{name}</strong>
        <small className="muted" dir="auto">
          {profile?.about || ''}
        </small>
      </span>
      {admin && <span className="tag">{t.admin}</span>}
    </button>
  )
}
