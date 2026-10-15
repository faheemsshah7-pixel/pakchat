// groups.ts: making a group, adding and removing people, admins, and the group's info.
// A group is a chat with type: 'group' and a title. Whoever makes it is its admin,
// and can make other people admins too. Only admins can add or remove people,
// or change the group's name, photo, description and settings. Anyone can leave.
// Each change also adds a small grey note to the chat, like "Ali added Sara".
import { arrayRemove, arrayUnion, collection, doc, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore'
import { db } from './firebase'
import { addMessage, type Chat, type Person, type SystemEvent } from './chats'
import { saveMedia } from './media'

// Adds a grey note ("Ali changed the group name") and changes some of the chat's fields, together.
async function change(me: Person, chat: Chat, event: SystemEvent, fields: object, targetName?: string) {
  const batch = writeBatch(db)
  const message = { kind: 'system', event, senderId: me.uid, senderName: me.name, ...(targetName ? { targetName } : {}) }
  addMessage(batch, { chatId: chat.id }, message, me, fields)
  await batch.commit()
}

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

export function addMember(me: Person, chat: Chat, person: Person) {
  return change(me, chat, 'added', { members: arrayUnion(person.uid), names: { [person.uid]: person.name } }, person.name)
}

export function removeMember(me: Person, chat: Chat, person: Person) {
  return change(me, chat, 'removed', { members: arrayRemove(person.uid), admins: arrayRemove(person.uid) }, person.name)
}

export function leaveGroup(me: Person, chat: Chat) {
  const fields: Record<string, unknown> = { members: arrayRemove(me.uid), admins: arrayRemove(me.uid) }
  // If the person who made the group leaves, another admin takes over (or else the next person),
  // so someone can still look after the group.
  if (chat.admin === me.uid) {
    const next = chat.admins?.find((uid) => uid !== me.uid && chat.members.includes(uid)) ?? chat.members.find((uid) => uid !== me.uid)
    if (next) fields.admin = next
  }
  return change(me, chat, 'left', fields)
}

// Make someone an admin, or take it away. (No grey note for this, like WhatsApp.)
export function setAdmin(chat: Chat, uid: string, admin: boolean) {
  return updateDoc(doc(db, 'chats', chat.id), { admins: admin ? arrayUnion(uid) : arrayRemove(uid) })
}

export function renameGroup(me: Person, chat: Chat, title: string) {
  return change(me, chat, 'renamed', { title }, title)
}

export function setDescription(me: Person, chat: Chat, description: string) {
  return change(me, chat, 'description', { description })
}

// The group photo is saved like a photo message (in the chat's media), and photoId points to it.
export async function setGroupPhoto(me: Person, chat: Chat, data: string | null) {
  const batch = writeBatch(db)
  let photoId = ''
  if (data) {
    photoId = saveMedia(batch, doc(db, 'chats', chat.id), data, me.uid)
  }
  addMessage(batch, { chatId: chat.id }, { kind: 'system', event: 'photo', senderId: me.uid, senderName: me.name }, me, { photoId })
  await batch.commit()
}

// "Only admins can send messages" on or off.
export function setOnlyAdmins(me: Person, chat: Chat, onlyAdmins: boolean) {
  return change(me, chat, onlyAdmins ? 'onlyAdmins' : 'everyone', { onlyAdmins })
}
