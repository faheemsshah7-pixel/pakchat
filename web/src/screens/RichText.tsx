// RichText.tsx: shows a message's words with WhatsApp-style formatting:
//   *bold*   _italic_   ~strikethrough~   `code`   ```monospace```
// and makes web addresses clickable. It builds React pieces, never raw HTML,
// so nobody can sneak code into the page with a message.
// `highlight`: words to mark in yellow (when you search a chat).
import type { ReactNode } from 'react'

const LINK = /\b(?:https?:\/\/|www\.)[^\s<]+/gi
const STYLE = /```([\s\S]+?)```|`([^`\n]+)`|\*([^*\n]+)\*|_([^_\n]+)_|~([^~\n]+)~/g
// Formatting only counts at the edge of a word: "*hi*" is bold, but "2*3*4" isn't.
const EDGE = /[\s\p{P}\p{S}]/u

export default function RichText({ text, highlight = '' }: { text: string; highlight?: string }) {
  const key = { n: 0 } // React needs a different "key" for each piece
  const pieces: ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(LINK)) {
    // Leave full stops and brackets at the end of a link out of it.
    const address = match[0].replace(/[.,!?;:)\]'"]+$/, '')
    pieces.push(...format(text.slice(last, match.index), highlight, key))
    const href = address.toLowerCase().startsWith('www.') ? 'https://' + address : address
    pieces.push(
      <a key={key.n++} href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
        {mark(address, highlight, key)}
      </a>,
    )
    last = match.index + address.length
  }
  pieces.push(...format(text.slice(last), highlight, key))
  return <>{pieces}</>
}

function format(text: string, highlight: string, key: { n: number }): ReactNode[] {
  const pieces: ReactNode[] = []
  let last = 0
  const style = new RegExp(STYLE) // a fresh copy, because format() also runs inside itself (*_bold italic_*)
  let match: RegExpExecArray | null
  while ((match = style.exec(text))) {
    const start = match.index
    const end = start + match[0].length
    const inner = match.slice(1).find((part) => part !== undefined) ?? ''
    const before = text[start - 1]
    const after = text[end]
    const atEdges = (!before || EDGE.test(before)) && (!after || EDGE.test(after))
    if (!atEdges || inner.trim() !== inner) {
      style.lastIndex = start + 1 // not formatting after all: look again from the next letter
      continue
    }
    pieces.push(...mark(text.slice(last, start), highlight, key))
    const k = key.n++
    if (match[1] !== undefined) pieces.push(<code key={k} className="mono">{inner}</code>)
    else if (match[2] !== undefined) pieces.push(<code key={k}>{inner}</code>)
    else if (match[3] !== undefined) pieces.push(<strong key={k}>{format(inner, highlight, key)}</strong>)
    else if (match[4] !== undefined) pieces.push(<em key={k}>{format(inner, highlight, key)}</em>)
    else pieces.push(<s key={k}>{format(inner, highlight, key)}</s>)
    last = end
  }
  pieces.push(...mark(text.slice(last), highlight, key))
  return pieces
}

// Wrap each place the searched words appear in <mark>.
function mark(text: string, highlight: string, key: { n: number }): ReactNode[] {
  if (!text) return []
  if (!highlight) return [text]
  const pieces: ReactNode[] = []
  const lower = text.toLowerCase()
  const find = highlight.toLowerCase()
  let last = 0
  for (let at = lower.indexOf(find); at !== -1; at = lower.indexOf(find, at + find.length)) {
    pieces.push(text.slice(last, at), <mark key={key.n++}>{text.slice(at, at + find.length)}</mark>)
    last = at + find.length
  }
  pieces.push(text.slice(last))
  return pieces
}
