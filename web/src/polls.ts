// polls.ts: polls in a chat, like WhatsApp's. Paperclip > Poll.
//
// A poll is a message with kind 'poll':
//   text:    the question
//   options: ['Biryani', 'Karahi', 'Nihari']   2 to 12 answers
//   multi:   true = people may pick more than one answer
//   votes:   { uidA: [0], uidB: [0, 2] }   which answers each person picked (by number)
// Everyone writes only their OWN vote (firestore.rules checks it), so two people voting at
// the same moment don't undo each other.
import { deleteField, doc, updateDoc } from 'firebase/firestore'
import { db } from './firebase'
import type { Message } from './chats'

export const MAX_OPTIONS = 12
export const MAX_QUESTION = 255
export const MAX_OPTION = 100

// Pick (or un-pick) answers. An empty list takes your vote away.
// "votes.<uid>" changes just your part of the map.
export function vote(chatId: string, messageId: string, uid: string, picked: number[]) {
  return updateDoc(doc(db, 'chats', chatId, 'messages', messageId), {
    [`votes.${uid}`]: picked.length ? [...picked].sort((a, b) => a - b) : deleteField(),
  })
}

// What happens when you tap answer number i: with "multiple answers" it switches on or off;
// otherwise it becomes your only answer (tap it again to take your vote back).
export function nextPick(m: Message, uid: string, i: number) {
  const mine = m.votes?.[uid] ?? []
  if (m.multi) return mine.includes(i) ? mine.filter((n) => n !== i) : [...mine, i]
  return mine.includes(i) ? [] : [i]
}

// For each answer: who picked it. Plus how many people voted at all.
export function tally(m: Message) {
  const options = m.options ?? []
  const voters = options.map(() => [] as string[])
  const votes = Object.entries(m.votes ?? {})
  for (const [uid, picked] of votes) {
    for (const i of picked) if (voters[i]) voters[i].push(uid)
  }
  const people = votes.filter(([, picked]) => picked.length > 0).length
  const most = Math.max(0, ...voters.map((v) => v.length))
  return { voters, people, most }
}

// The answers you typed, tidied: no spaces at the ends, no empty ones, no repeats.
export function cleanOptions(options: string[]) {
  const seen = new Set<string>()
  const clean: string[] = []
  for (const option of options.map((o) => o.trim()).filter(Boolean)) {
    const key = option.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    clean.push(option.slice(0, MAX_OPTION))
  }
  return clean.slice(0, MAX_OPTIONS)
}
