// mentions.ts: @mentions in groups, like WhatsApp's.
// Type @ in a group's message box and pick someone: "@Ali " goes into the message.
// The message also saves WHO was mentioned (mentions: [uid, ...]), so their name shows in
// colour, and their chat list shows "@" until they read it.
import type { Person } from './chats'

// The "@ali" being typed just before the cursor, or null. ("@" must start a word.)
export function mentionQuery(text: string, caret: number) {
  const before = text.slice(0, caret)
  const match = /(^|\s)@([^\s@]{0,30})$/u.exec(before)
  return match ? { query: match[2], start: before.length - match[2].length - 1 } : null
}

// Everyone whose "@Name" is in the text. Longer names first, so "@Ali Khan" isn't also "@Ali".
export function findMentions(text: string, people: Person[]) {
  const found: string[] = []
  let rest = text
  for (const p of [...people].sort((a, b) => b.name.length - a.name.length)) {
    if (!p.name) continue
    const tag = '@' + p.name
    if (!rest.includes(tag)) continue
    found.push(p.uid)
    rest = rest.split(tag).join(' ')
  }
  return found.slice(0, 50)
}
