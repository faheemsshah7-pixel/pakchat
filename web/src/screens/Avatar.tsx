// Avatar.tsx: the round picture next to a name.
// With a photo, it shows the photo. Without one, a coloured circle with the first letter
// (or a group icon). The colour comes from the name, so each person always gets the same one.
import { isGroup, otherPerson, type Chat } from '../chats'
import { avatarBackground } from '../colours'
import { useMedia } from '../media'
import { useAvatar, useProfile } from '../profiles'
import Icon from './Icon'

type Props = { name: string; group?: boolean; size?: number; photo?: string | null }

export default function Avatar({ name, group = false, size = 48, photo }: Props) {
  const style = { background: avatarBackground(name), width: size, height: size, fontSize: size * 0.42 }
  if (photo) return <img className="avatar" style={{ width: size, height: size }} src={photo} alt="" />
  return (
    <span className="avatar" style={style} aria-hidden>
      {group ? <Icon name="users" size={size * 0.48} /> : (name.trim()[0] ?? '?').toUpperCase()}
    </span>
  )
}

// A person's avatar, with their profile photo if they have one.
export function PersonAvatar({ uid, name, size }: { uid: string; name: string; size?: number }) {
  const profile = useProfile(uid)
  const photo = useAvatar(uid, profile?.photo)
  return <Avatar name={name} size={size} photo={photo} />
}

// A group's avatar, with the group photo if it has one.
export function GroupAvatar({ chat, size }: { chat: Chat; size?: number }) {
  const photo = useMedia(chat.id, chat.photoId || undefined)
  return <Avatar name={chat.title ?? ''} group size={size} photo={photo} />
}

// The avatar for a chat in the list: the group's, or the other person's.
export function ChatAvatar({ chat, myUid, size }: { chat: Chat; myUid: string; size?: number }) {
  if (isGroup(chat)) return <GroupAvatar chat={chat} size={size} />
  const other = otherPerson(chat, myUid)
  return <PersonAvatar uid={other.uid} name={other.name} size={size} />
}
