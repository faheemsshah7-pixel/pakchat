// Polls.tsx: making a poll (Paperclip > Poll), the poll in the chat, and who voted for what.
// How polls are saved: see polls.ts.
import { useRef, useState } from 'react'
import type { Message } from '../chats'
import { useT } from '../lang'
import { cleanOptions, MAX_OPTION, MAX_OPTIONS, MAX_QUESTION, nextPick, tally, vote } from '../polls'
import { fill } from '../strings'
import { PersonAvatar } from './Avatar'
import Icon from './Icon'
import Modal from './Modal'
import Switch from './Switch'

// ---------- Making a poll ----------
// A question and answers. A new empty answer box appears as you fill the last one (up to 12).
type Option = { id: number; text: string } // (the id keeps each box the same box when one is taken out)
type DialogProps = { onSend: (question: string, options: string[], multi: boolean) => void; onClose: () => void }

export function PollDialog({ onSend, onClose }: DialogProps) {
  const { t } = useT()
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState<Option[]>([
    { id: 0, text: '' },
    { id: 1, text: '' },
  ])
  const [multi, setMulti] = useState(true) // WhatsApp's polls allow several answers unless you switch it off
  const nextId = useRef(2)
  const list = useRef<HTMLDivElement>(null)

  const clean = cleanOptions(options.map((o) => o.text))
  const typed = options.filter((o) => o.text.trim()).length
  const repeated = typed !== clean.length // two answers say the same thing
  const ready = question.trim().length > 0 && clean.length >= 2 && !repeated

  // Always keep one empty box at the end (until there are 12).
  function tidy(next: Option[]) {
    const last = next[next.length - 1]
    if (last.text.trim() && next.length < MAX_OPTIONS) next.push({ id: nextId.current++, text: '' })
    return next
  }
  function change(id: number, text: string) {
    setOptions(tidy(options.map((o) => (o.id === id ? { ...o, text } : o))))
  }
  function remove(id: number) {
    let next = options.filter((o) => o.id !== id)
    while (next.length < 2) next = [...next, { id: nextId.current++, text: '' }]
    setOptions(tidy(next))
  }
  // Enter in an answer box goes to the next one.
  function enter(e: React.KeyboardEvent<HTMLInputElement>, i: number) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    list.current?.querySelectorAll('input')[i + 1]?.focus()
  }

  return (
    <Modal title={t.createPoll} onClose={onClose} className="narrow poll-dialog">
      <p className="poll-label">{t.question}</p>
      <div className="field">
        <input dir="auto" placeholder={t.askQuestion} value={question} maxLength={MAX_QUESTION} onChange={(e) => setQuestion(e.target.value)} autoFocus />
      </div>
      <p className="poll-label">{t.pollOptions}</p>
      <div className="poll-edit" ref={list}>
        {options.map((o, i) => (
          <div key={o.id} className="field">
            <input
              dir="auto"
              placeholder={t.addOption}
              aria-label={fill(t.optionN, { n: i + 1 })}
              value={o.text}
              maxLength={MAX_OPTION}
              onChange={(e) => change(o.id, e.target.value)}
              onKeyDown={(e) => enter(e, i)}
            />
            {o.text && (
              <button type="button" className="icon" aria-label={t.removeOption} title={t.removeOption} onClick={() => remove(o.id)}>
                <Icon name="close" size={18} />
              </button>
            )}
          </div>
        ))}
      </div>
      {repeated && <p className="error">{t.optionRepeated}</p>}
      <Switch label={t.allowMultiple} on={multi} onChange={setMulti} />
      <button
        className="btn"
        disabled={!ready}
        onClick={() => {
          onSend(question.trim(), clean, multi)
          onClose()
        }}
      >
        <Icon name="send" size={18} /> {t.send}
      </button>
    </Modal>
  )
}

// ---------- A poll in the chat ----------
// Tap an answer to vote. The bar and number show how many picked it, with a few of their faces.
type BubbleProps = {
  chatId: string
  m: Message
  myUid: string
  canVote: boolean // (not if you can't send messages here, or it's still on its way)
  nameOf: (uid: string) => string
  onVotes: (m: Message) => void // "View votes"
}

export function PollBubble({ chatId, m, myUid, canVote, nameOf, onVotes }: BubbleProps) {
  const { t } = useT()
  const [failed, setFailed] = useState(false)
  const { voters, people } = tally(m)
  const mine = m.votes?.[myUid] ?? []
  const open = canVote && !m.pending

  function pick(i: number) {
    if (!open) return
    setFailed(false)
    vote(chatId, m.id, myUid, nextPick(m, myUid, i)).catch((err) => {
      console.error(err)
      setFailed(true)
    })
  }

  return (
    <div className="poll">
      <strong className="poll-question" dir="auto">
        {m.text}
      </strong>
      <small className="poll-hint">
        <Icon name={m.multi ? 'checks' : 'check'} size={14} /> {m.multi ? t.selectMany : t.selectOne}
      </small>
      {(m.options ?? []).map((option, i) => {
        const n = voters[i]?.length ?? 0
        const on = mine.includes(i)
        return (
          <button
            type="button"
            key={i}
            className={on ? 'poll-option on' : 'poll-option'}
            role={m.multi ? 'checkbox' : 'radio'}
            aria-checked={on}
            disabled={!open}
            onClick={() => pick(i)}
          >
            <span className={m.multi ? 'poll-box' : 'poll-box round'} aria-hidden>
              {on && <Icon name="check" size={14} />}
            </span>
            <span className="poll-main">
              <span className="poll-row">
                <span className="poll-text" dir="auto">
                  {option}
                </span>
                <span className="poll-faces" aria-hidden>
                  {voters[i]?.slice(0, 3).map((uid) => (
                    <PersonAvatar key={uid} uid={uid} name={nameOf(uid)} size={18} />
                  ))}
                </span>
                <span className="poll-count">{n}</span>
              </span>
              <span className="poll-bar">
                <span style={{ width: people ? `${(n / people) * 100}%` : '0%' }} />
              </span>
            </span>
          </button>
        )
      })}
      {failed && <small className="error">{t.voteFailed}</small>}
      <button type="button" className="poll-votes" disabled={people === 0} onClick={() => onVotes(m)}>
        {people ? t.viewVotes : t.noVotesYet}
      </button>
    </div>
  )
}

// ---------- Who voted for what ----------
type VotesProps = { m: Message; myUid: string; nameOf: (uid: string) => string; onClose: () => void }

export function VotesDialog({ m, myUid, nameOf, onClose }: VotesProps) {
  const { t } = useT()
  const { voters, people } = tally(m)
  return (
    <Modal title={t.pollDetails} onClose={onClose} className="narrow">
      <p className="info-quote" dir="auto">
        <strong>{m.text}</strong>
        <small>{fill(people === 1 ? t.onePersonVoted : t.peopleVoted, { n: people })}</small>
      </p>
      {(m.options ?? []).map((option, i) => (
        <section key={i} className="vote-group">
          <p className="section-title vote-title">
            <span dir="auto">{option}</span>
            <span>{fill(voters[i].length === 1 ? t.oneVote : t.manyVotes, { n: voters[i].length })}</span>
          </p>
          {voters[i].map((uid) => (
            <div key={uid} className="row">
              <PersonAvatar uid={uid} name={nameOf(uid)} size={36} />
              <strong className="row-main" dir="auto">
                {uid === myUid ? t.you : nameOf(uid)}
              </strong>
            </div>
          ))}
        </section>
      ))}
    </Modal>
  )
}
