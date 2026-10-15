// colours.ts: each person gets their own colour, picked from their name.
// The same name always gives the same colour (for avatars and names in groups).
const COLOURS = [
  ['#10b981', '#047857'],
  ['#3b82f6', '#1d4ed8'],
  ['#a855f7', '#7e22ce'],
  ['#f97316', '#c2410c'],
  ['#ec4899', '#be185d'],
  ['#14b8a6', '#0f766e'],
  ['#84cc16', '#4d7c0f'],
  ['#f43f5e', '#be123c'],
]

function pick(name: string) {
  let sum = 0
  for (const ch of name) sum += ch.codePointAt(0) ?? 0
  return COLOURS[sum % COLOURS.length]
}

// A soft two-colour gradient for avatars.
export function avatarBackground(name: string) {
  const [light, dark] = pick(name)
  return `linear-gradient(135deg, ${light}, ${dark})`
}

// The colour of someone's name above their messages in a group.
export function nameColour(name: string) {
  return pick(name)[0]
}
