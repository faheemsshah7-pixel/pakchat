// groups.ts: making a group, adding people, leaving.
// A group is a chat with type: 'group', a title, and an admin (whoever made it).
// Only the admin can add people. Anyone can leave.
import { arrayRemove, arrayUnion, collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore'
import { db } from './firebase'
import { addMessage, type Chat, type Person } from './chats'

export async function createGroup(me: Person, title: string, people: Person[]) {
  const chatRef = doc(collection(db, 'chats')) // random id
  const everyone = [me, ...people]
  const batch = writeBatch(db)
  const fields = {
    type: 'group',
    title,
    admin: me.uid,
    members: everyone.map((p) => p.uid),
    names: Object.fromEntries(everyone.map((p) => [p.uid, p.name])),
    createdAt: serverTimestamp(),
  }
  addMessage(batch, { chatId: chatRef.id }, { kind: 'system', event: 'created', senderId: me.uid, senderName: me.name }, me, fields)
  await batch.commit()
  return chatRef.id
}

export async function addMember(me: Person, chat: Chat, person: Person) {
  const batch = writeBatch(db)
  const fields = { members: arrayUnion(person.uid), names: { [person.uid]: person.name } }
  const message = { kind: 'system', event: 'added', senderId: me.uid, senderName: me.name, targetName: person.name }
  addMessage(batch, { chatId: chat.id }, message, me, fields)
  await batch.commit()
}

export async function leaveGroup(me: Person, chat: Chat) {
  const batch = writeBatch(db)
  const fields: Record<string, unknown> = { members: arrayRemove(me.uid) }
  // If the admin leaves, the next person becomes admin, so someone can still add people.
  const next = chat.members.find((uid) => uid !== me.uid)
  if (chat.admin === me.uid && next) fields.admin = next
  addMessage(batch, { chatId: chat.id }, { kind: 'system', event: 'left', senderId: me.uid, senderName: me.name }, me, fields)
  await batch.commit()
}
