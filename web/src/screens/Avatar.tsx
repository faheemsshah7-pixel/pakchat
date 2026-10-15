// Avatar.tsx: a coloured circle with the first letter of a name.
// The colour comes from the name, so each person always gets the same one.
const COLOURS = ['#0b6b35', '#1e6fa8', '#8a4fbf', '#c0582b', '#b0306a', '#2c8c8c', '#6b7d1d']

export default function Avatar({ name, group = false }: { name: string; group?: boolean }) {
  let sum = 0
  for (const ch of name) sum += ch.codePointAt(0) ?? 0
  return (
    <span className="avatar" style={{ background: COLOURS[sum % COLOURS.length] }} aria-hidden>
      {group ? '👥' : (name.trim()[0] ?? '?').toUpperCase()}
    </span>
  )
}
