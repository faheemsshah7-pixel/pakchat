// communities.ts: communities, like WhatsApp's. A community brings groups together under one name
// (a school, a family, a mohalla), with an "Announcements" group that everyone in it gets.
//
//   communities/<id>
//     name, description
//     owner: who made it (nobody can take them off, and only they can deactivate it)
//     admins: [uid, ...]        who looks after it (the owner too)
//     members: [uid, ...]       everyone in it (up to 256)
//     names: { uid: 'Ali' }
//     groups: { chatId: 'Cricket' }   its groups, with their names (so you can see the ones you're not in)
//     announcementsId           the announcements group
//     inviteCode                its invite link, if it has one (invites.ts)
//
// The announcements group is a normal group (chats/<id>) with announcements: true, communityId and
// "only admins can send" on. Everyone in the community is in it, and the community's admins are its
// admins too. So adding someone to the community adds them there as well, in the same write.
// The other groups just have communityId. Anyone in the community can join them (the rules check).
// Only people in a community can see it (the rules again).
import { arrayRemove, arrayUnion, collection, deleteField, doc, onSnapshot, query, serverTimestamp, updateDoc, where, writeBatch } from 'firebase/firestore'
import { addMessage, isAdmin, type Chat, type Person } from './chats'
import { db } from './firebase'
import { leaveGroup } from './groups'
import { newCode, type Invite } from './invites'

export type Community = {
  id: string
  name: string
  description?: string
  owner: string
  admins: string[]
  members: string[]
  names: Record<string, string>
  groups: Record<string, string> // chatId: the group's name
  announcementsId: string
  inviteCode?: string
}

export const MAX_MEMBERS = 256 // (as many as a group can have, since everyone is in the announcements group)
export const MAX_GROUPS = 50

const communityRef = (id: string) => doc(db, 'communities', id)
const chatRef = (id: string) => doc(db, 'chats', id)
const nameFields = (people: Person[]) => Object.fromEntries(people.map((p) => [`names.${p.uid}`, p.name]))

// Your communities, kept up to date live, A to Z.
export function listenToCommunities(uid: string, onChange: (list: Community[]) => void) {
  const mine = query(collection(db, 'communities'), where('members', 'array-contains', uid))
  return onSnapshot(
    mine,
    (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Community).sort((a, b) => a.name.localeCompare(b.name))),
    (err) => console.error(err),
  )
}

export const isCommunityAdmin = (community: Community, uid: string) => community.admins.includes(uid)

// A new community, with its announcements group. Both are saved together (one batch),
// so there's never a community without one.
export async function createCommunity(me: Person, name: string, description: string, people: Person[]) {
  const community = doc(collection(db, 'communities')) // random ids
  const announcements = doc(collection(db, 'chats'))
  const everyone = [me, ...people]
  const members = everyone.map((p) => p.uid)
  const names = Object.fromEntries(everyone.map((p) => [p.uid, p.name]))
  const batch = writeBatch(db)
  const group = { type: 'group', title: name, admin: me.uid, members, names, communityId: community.id, announcements: true, onlyAdmins: true, createdAt: serverTimestamp() }
  addMessage(batch, { chatId: announcements.id }, { kind: 'system', event: 'communityCreated', senderId: me.uid, senderName: me.name }, me, group)
  batch.set(community, { name, description, owner: me.uid, admins: [me.uid], members, names, groups: {}, announcementsId: announcements.id, createdAt: serverTimestamp() })
  await batch.commit()
  return community.id
}

// Rename it. The announcements group has the community's name, so it changes too.
export async function renameCommunity(me: Person, community: Community, name: string) {
  const batch = writeBatch(db)
  batch.update(communityRef(community.id), { name })
  addMessage(batch, { chatId: community.announcementsId }, { kind: 'system', event: 'renamed', senderId: me.uid, senderName: me.name, targetName: name }, me, { title: name })
  await batch.commit()
}

export function describeCommunity(community: Community, description: string) {
  return updateDoc(communityRef(community.id), { description })
}

// Add people: to the community and its announcements group.
export async function addToCommunity(me: Person, community: Community, people: Person[]) {
  const fresh = people.filter((p) => !community.members.includes(p.uid))
  if (fresh.length === 0) return
  if (community.members.length + fresh.length > MAX_MEMBERS) throw new Error('too-many')
  const uids = fresh.map((p) => p.uid)
  const batch = writeBatch(db)
  batch.update(communityRef(community.id), { members: arrayUnion(...uids), ...nameFields(fresh) })
  const note = { kind: 'system', event: 'added', senderId: me.uid, senderName: me.name, targetName: fresh.map((p) => p.name).join(', ') }
  addMessage(batch, { chatId: community.announcementsId }, note, me, { members: arrayUnion(...uids), names: Object.fromEntries(fresh.map((p) => [p.uid, p.name])) })
  await batch.commit()
}

// Take someone out of the community (and its announcements group). The owner can't be.
export async function removeFromCommunity(me: Person, community: Community, person: Person) {
  const batch = writeBatch(db)
  batch.update(communityRef(community.id), { members: arrayRemove(person.uid), admins: arrayRemove(person.uid) })
  const note = { kind: 'system', event: 'removed', senderId: me.uid, senderName: me.name, targetName: person.name }
  addMessage(batch, { chatId: community.announcementsId }, note, me, { members: arrayRemove(person.uid), admins: arrayRemove(person.uid) })
  await batch.commit()
}

// Make someone an admin of the community (and so of its announcements group), or take it away.
export async function setCommunityAdmin(community: Community, uid: string, admin: boolean) {
  const change = admin ? arrayUnion(uid) : arrayRemove(uid)
  const batch = writeBatch(db)
  batch.update(communityRef(community.id), { admins: change })
  batch.update(chatRef(community.announcementsId), { admins: change })
  await batch.commit()
}

// A new group in the community. You're its admin, and to start with its only member:
// the others join it from the community.
export async function newCommunityGroup(me: Person, community: Community, title: string) {
  if (Object.keys(community.groups).length >= MAX_GROUPS) throw new Error('too-many-groups')
  const group = doc(collection(db, 'chats'))
  const batch = writeBatch(db)
  const fields = { type: 'group', title, admin: me.uid, members: [me.uid], names: { [me.uid]: me.name }, communityId: community.id, createdAt: serverTimestamp() }
  addMessage(batch, { chatId: group.id }, { kind: 'system', event: 'created', senderId: me.uid, senderName: me.name }, me, fields)
  batch.update(communityRef(community.id), { [`groups.${group.id}`]: title })
  await batch.commit()
  return group.id
}

// Groups you're an admin of that could join the community (not in one already, not a community's announcements).
export function groupsToLink(chats: Chat[], myUid: string) {
  return chats.filter((c) => isAdmin(c, myUid) && !c.communityId && !c.announcements)
}

// Add groups you're an admin of. Everyone in them joins the community too (like WhatsApp),
// so they get its announcements and can see its other groups.
export async function linkGroups(community: Community, groups: Chat[]) {
  if (Object.keys(community.groups).length + groups.length > MAX_GROUPS) throw new Error('too-many-groups')
  const newcomers = new Map<string, string>()
  for (const g of groups) for (const uid of g.members) if (!community.members.includes(uid)) newcomers.set(uid, g.names[uid] ?? '?')
  if (community.members.length + newcomers.size > MAX_MEMBERS) throw new Error('too-many')
  const people = [...newcomers].map(([uid, name]) => ({ uid, name }))
  const joining = people.length ? { members: arrayUnion(...people.map((p) => p.uid)), ...nameFields(people) } : {}
  const batch = writeBatch(db)
  for (const g of groups) batch.update(chatRef(g.id), { communityId: community.id })
  batch.update(communityRef(community.id), { ...Object.fromEntries(groups.map((g) => [`groups.${g.id}`, g.title ?? ''])), ...joining })
  if (people.length) batch.update(chatRef(community.announcementsId), joining)
  await batch.commit()
}

// Take a group out of the community. It carries on as a normal group.
// (Only one of its admins can clear its communityId. If you aren't one, it's left: the community
// no longer lists it, so nobody can join it from there.)
export async function unlinkGroup(myUid: string, community: Community, chatId: string, chat?: Chat) {
  const batch = writeBatch(db)
  batch.update(communityRef(community.id), { [`groups.${chatId}`]: deleteField() })
  if (chat && isAdmin(chat, myUid)) batch.update(chatRef(chatId), { communityId: deleteField() })
  await batch.commit()
}

// Join one of the community's groups, with a grey note: "Ali joined from the community".
export async function joinCommunityGroup(me: Person, chatId: string) {
  const batch = writeBatch(db)
  addMessage(batch, { chatId }, { kind: 'system', event: 'joinedGroup', senderId: me.uid, senderName: me.name }, me, { members: arrayUnion(me.uid), names: { [me.uid]: me.name } })
  await batch.commit()
}

// Leave the community: its announcements, every group of it you're in, and the community itself.
// (The owner can't leave. They can deactivate it instead.)
// (Each group is left on its own: the rules look up each group, and one write can only look up
// so many things. The community itself goes last, so if something fails you can try again.)
export async function leaveCommunity(me: Person, community: Community, chats: Chat[]) {
  const groups = chats.filter((chat) => (chat.id === community.announcementsId || chat.id in community.groups) && chat.members.includes(me.uid))
  await Promise.all(groups.map((chat) => leaveGroup(me, chat)))
  await updateDoc(communityRef(community.id), { members: arrayRemove(me.uid), admins: arrayRemove(me.uid) })
}

// Deactivate it (the owner only). The community goes; its groups carry on as normal groups,
// and so does the announcements group.
export async function deactivateCommunity(community: Community) {
  const batch = writeBatch(db)
  if (community.inviteCode) batch.delete(doc(db, 'invites', community.inviteCode))
  batch.delete(communityRef(community.id))
  await batch.commit()
}

// ----- Invite links (like a group's, see invites.ts) -----
// The invite says which community, and which group is its announcements group, because you can't
// look inside a community before you're in it.

export async function resetCommunityInvite(me: Person, community: Community) {
  const code = newCode()
  const batch = writeBatch(db)
  if (community.inviteCode) batch.delete(doc(db, 'invites', community.inviteCode))
  batch.update(communityRef(community.id), { inviteCode: code })
  batch.set(doc(db, 'invites', code), { communityId: community.id, chatId: community.announcementsId, title: community.name, by: me.uid })
  await batch.commit()
}

export async function removeCommunityInvite(community: Community) {
  if (!community.inviteCode) return
  const batch = writeBatch(db)
  batch.delete(doc(db, 'invites', community.inviteCode))
  batch.update(communityRef(community.id), { inviteCode: deleteField() })
  await batch.commit()
}

// Join with a link: you're added to the community and its announcements group, together.
export async function joinCommunity(me: Person, invite: Invite & { communityId: string }) {
  const batch = writeBatch(db)
  batch.update(communityRef(invite.communityId), { members: arrayUnion(me.uid), [`names.${me.uid}`]: me.name, joinCode: invite.code })
  addMessage(batch, { chatId: invite.chatId }, { kind: 'system', event: 'joinedCommunity', senderId: me.uid, senderName: me.name }, me, { members: arrayUnion(me.uid), names: { [me.uid]: me.name } })
  await batch.commit()
}
