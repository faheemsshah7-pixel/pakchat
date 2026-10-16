// invites.ts: group invite links, like https://pakchat-f89d8.web.app/join/k3J9x...
// (A community's link works the same way: see communities.ts.)
//
// An admin makes a link. Its code is long and random, so nobody can guess it.
//   invites/<code>   { chatId, title, by }   so the link can say which group it's for
//   chats/<chatId>.inviteCode = <code>       the code that works right now
// To join, you send the code along with your request, and the security rules check
// it matches the group's current code. "Reset link" makes a new code, so old links stop working.
import { arrayUnion, deleteField, doc, getDoc, writeBatch } from 'firebase/firestore'
import { db } from './firebase'
import { addMessage, type Chat, type Person } from './chats'

// communityId: it's a community's link (chatId is then its announcements group).
export type Invite = { code: string; chatId: string; title: string; communityId?: string }

// A long random code for a link (also used for call links, callExtras.ts).
export function newCode() {
  const letters = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const random = crypto.getRandomValues(new Uint8Array(20)) // the browser's secure random numbers
  return Array.from(random, (n) => letters[n % letters.length]).join('')
}

export function inviteLink(code: string) {
  return `${location.origin}/join/${code}`
}

// Make a new link (and switch off the old one, if there was one).
export async function resetInvite(me: Person, chat: Chat) {
  const code = newCode()
  const batch = writeBatch(db)
  if (chat.inviteCode) batch.delete(doc(db, 'invites', chat.inviteCode))
  batch.update(doc(db, 'chats', chat.id), { inviteCode: code })
  batch.set(doc(db, 'invites', code), { chatId: chat.id, title: chat.title ?? '', by: me.uid })
  await batch.commit()
  return code
}

// Switch the link off, so nobody new can join with it.
export async function removeInvite(chat: Chat) {
  if (!chat.inviteCode) return
  const batch = writeBatch(db)
  batch.delete(doc(db, 'invites', chat.inviteCode))
  batch.update(doc(db, 'chats', chat.id), { inviteCode: deleteField() })
  await batch.commit()
}

// What's behind a link? null = it doesn't work (wrong or reset).
export async function lookupInvite(code: string): Promise<Invite | null> {
  const snap = await getDoc(doc(db, 'invites', code))
  if (!snap.exists()) return null
  return { code, chatId: snap.get('chatId'), title: snap.get('title'), communityId: snap.get('communityId') }
}

// Join: add yourself to the group, with a grey note "Ali joined using this group's invite link".
export async function joinGroup(me: Person, invite: Invite) {
  const batch = writeBatch(db)
  const fields = {
    members: arrayUnion(me.uid), // add me to the list of members
    names: { [me.uid]: me.name },
    joinCode: invite.code, // the rules check this matches the group's code
  }
  addMessage(batch, { chatId: invite.chatId }, { kind: 'system', event: 'joined', senderId: me.uid, senderName: me.name }, me, fields)
  await batch.commit()
}

// The code from a link like /join/<code>, if the page was opened with one.
export function codeFromAddress() {
  const match = location.pathname.match(/^\/join\/([A-Za-z0-9]{16,})/)
  return match?.[1] ?? null
}
