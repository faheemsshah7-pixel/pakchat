// BroadcastInfo.tsx: about a broadcast list (broadcasts.ts): its name, who's on it, the photos and
// videos you sent, starred messages and the wallpaper. Rename it, add or take people off, or delete it.
// Only you can see a list: the people on it don't know it exists.
import { useState } from 'react'
import { MAX_RECIPIENTS, renameList, setRecipients } from '../broadcasts'
import { chatTitle, findUser, type Chat, type Message, type Person } from '../chats'
import { useT } from '../lang'
import { fill } from '../strings'
import Avatar, { PersonAvatar } from './Avatar'
import { ActionRow, ChatExtras, type ChatActions, type Looks } from './ContactInfo'
import { PeopleDialog } from './Dialogs'
import Icon from './Icon'
import MediaGrid from './MediaGrid'

type Props = {
  me: Person
  chat: Chat
  people: Person[] // everyone you know (to add to the list)
  messages: Message[]
  starred: number // how many messages you starred here
  looks: Looks // the list's wallpaper, in words
  actions: ChatActions
  onBack: () => void
  onOpenPerson: (person: Person) => void // your chat with someone on the list
  onView: (m: Message, data: string) => void
}

export default function BroadcastInfo({ me, chat, people, messages, starred, looks, actions, onBack, onOpenPerson, onView }: Props) {
  const { t } = useT()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [number, setNumber] = useState('')
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const recipients = chat.recipients ?? []
  const person = (uid: string): Person => people.find((p) => p.uid === uid) ?? { uid, name: chat.names[uid] ?? '?' }
  const title = chatTitle(chat, me.uid)

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

  // The list's new people (from "Add or remove people", or taking someone off). At least one.
  function save(uids: string[]) {
    if (uids.length === 0) return setError(t.atLeastOne)
    attempt(() => setRecipients(chat, uids.slice(0, MAX_RECIPIENTS).map(person)))
  }

  // Add someone by their number or Gmail.
  async function add(e: React.FormEvent) {
    e.preventDefault()
    await attempt(async () => {
      const found = await findUser(number)
      if (!found) return setError(t.notOnPakChat)
      if (found.uid === me.uid) return setError(t.ownNumber)
      if (recipients.includes(found.uid)) return setError(t.alreadyOnList)
      if (recipients.length >= MAX_RECIPIENTS) return setError(t.somethingWrong)
      await setRecipients(chat, [...recipients.map(person), found])
      setNumber('')
    })
  }

  async function rename(e: React.FormEvent) {
    e.preventDefault()
    const text = draft.trim()
    if (text !== (chat.title ?? '')) await attempt(() => renameList(chat, text))
    setEditing(false)
  }

  // For "Add or remove people": everyone you know, and anyone on the list you added by number.
  const choices = [...people, ...recipients.filter((uid) => !people.some((p) => p.uid === uid)).map(person)]

  return (
    <div className="pane info-pane">
      <header className="bar">
        <button className="icon" onClick={onBack} aria-label={t.close}>
          <Icon name="close" />
        </button>
        <h2>{t.listInfo}</h2>
      </header>

      <div className="list">
        <div className="info-hero">
          <Avatar name={title} list size={120} />
          {editing ? (
            <form className="inline-edit" onSubmit={rename}>
              <input dir="auto" value={draft} maxLength={50} placeholder={t.listName} onChange={(e) => setDraft(e.target.value)} autoFocus aria-label={t.listName} />
              <button className="icon" aria-label={t.save}>
                <Icon name="check" />
              </button>
            </form>
          ) : (
            <h3 dir="auto">
              {title}
              <button
                className="icon small"
                aria-label={t.editName}
                onClick={() => {
                  setDraft(chat.title ?? '')
                  setEditing(true)
                }}
              >
                <Icon name="edit" size={16} />
              </button>
            </h3>
          )}
          <p>
            {t.broadcastList} · {fill(t.nRecipients, { n: recipients.length })}
          </p>
        </div>

        <section className="info-section">
          <p className="about-text">{t.listNote}</p>
        </section>

        <MediaGrid chatId={chat.id} messages={messages} onView={onView} />
        <ChatExtras starred={starred} looks={looks} actions={actions} />

        <section className="info-section">
          <p className="section-title">{fill(t.nRecipients, { n: recipients.length })}</p>
          <button className="row action" disabled={busy} onClick={() => setPicking(true)}>
            <Icon name="users" />
            <span className="row-main">{t.editRecipients}</span>
          </button>
          <form className="newchat" onSubmit={add}>
            <div className="field">
              <Icon name="userPlus" size={20} />
              <input dir="ltr" placeholder={t.friendsNumber} aria-label={t.friendsNumber} value={number} onChange={(e) => setNumber(e.target.value)} />
            </div>
            <button className="btn small" disabled={busy || number.trim().length < 5}>
              {t.add}
            </button>
          </form>
          {error && <p className="error pad">{error}</p>}
          {recipients.map((uid) => {
            const who = person(uid)
            return (
              <div key={uid} className="row recipient">
                <PersonAvatar uid={uid} name={who.name} size={44} />
                <strong className="row-main" dir="auto">
                  {who.name}
                </strong>
                <button className="icon small" aria-label={fill(t.messageName, { name: who.name })} title={fill(t.messageName, { name: who.name })} onClick={() => onOpenPerson(who)}>
                  <Icon name="chatPlus" size={18} />
                </button>
                {/* (A list needs at least one person, so the last one can't be taken off.) */}
                <button
                  className="icon small"
                  aria-label={fill(t.removeName, { name: who.name })}
                  title={fill(t.removeName, { name: who.name })}
                  disabled={busy || recipients.length <= 1}
                  onClick={() => save(recipients.filter((r) => r !== uid))}
                >
                  <Icon name="close" size={18} />
                </button>
              </div>
            )
          })}
        </section>

        <section className="info-section actions">
          <ActionRow icon="eraser" label={t.clearChat} onClick={actions.clear} />
          <ActionRow icon="trash" label={t.deleteList} onClick={actions.remove} danger />
        </section>
      </div>

      {picking && <PeopleDialog title={t.editRecipients} people={choices} picked={recipients} onDone={save} onClose={() => setPicking(false)} />}
    </div>
  )
}
