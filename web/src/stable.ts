// stable.ts: a small React helper for speed.
//
// React re-draws a part of the screen when what it was given changes. A function written
// inside a component, like `onClick={() => open(chat)}`, is a NEW function every time the
// component draws, so React thinks it changed even when it didn't. useStable gives you a
// function that stays the same forever but always runs your latest code. That lets
// memo() (MessageBubble.tsx, ChatList.tsx) skip messages and chats that didn't change.
import { useCallback, useLayoutEffect, useRef } from 'react'

export function useStable<Args extends unknown[], Result>(fn: (...args: Args) => Result) {
  const latest = useRef(fn)
  useLayoutEffect(() => {
    latest.current = fn
  })
  return useCallback((...args: Args) => latest.current(...args), [])
}
