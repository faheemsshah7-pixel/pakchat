// Avatar.tsx: a coloured circle with the first letter of a name (or a group icon).
// The colour comes from the name, so each person always gets the same one.
import { avatarBackground } from '../colours'
import Icon from './Icon'

export default function Avatar({ name, group = false, size = 48 }: { name: string; group?: boolean; size?: number }) {
  const style = { background: avatarBackground(name), width: size, height: size, fontSize: size * 0.42 }
  return (
    <span className="avatar" style={style} aria-hidden>
      {group ? <Icon name="users" size={size * 0.48} /> : (name.trim()[0] ?? '?').toUpperCase()}
    </span>
  )
}
