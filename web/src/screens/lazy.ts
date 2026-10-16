// lazy.ts: screens that load the first time they're needed, not when PakChat opens.
//
// Without this, the browser downloads ALL of PakChat before showing anything (about 1 MB).
// With it, the first download is the chat list and chats; Settings, Status, the call screens,
// the emoji panel, the photo viewer and editor, and the video message recorder come in their own small files ("chunks").
// A moment after PakChat opens, warmUp() fetches them quietly, so they're ready before you tap.
//
// When a new version is put online, the old chunk files are gone. Someone who had PakChat open
// from before would then fail to load one, so PakChat reloads itself once, into the new version.
import { lazy, type ComponentProps, type ComponentType } from 'react'

const RELOADED = 'pakchat.reloadedAt'

// Reload into the new version, at most once a minute (so a real network problem can't loop).
function reloadOnce() {
  try {
    const last = Number(sessionStorage.getItem(RELOADED) ?? 0)
    if (Date.now() - last < 60_000) return false
    sessionStorage.setItem(RELOADED, String(Date.now()))
  } catch {
    return false // (no storage: don't risk reloading again and again)
  }
  location.reload()
  return true
}

// Load a screen's file. If it's gone (a new version is online), reload once instead.
function later<T>(load: () => Promise<T>) {
  return () =>
    load().catch((err) => {
      if (reloadOnce()) return new Promise<T>(() => {}) // (the page is reloading: wait for it)
      throw err
    })
}

// A screen that's its file's default export, or a named one: piece('StartCallDialog').
type Module = Record<string, unknown>
function screen<P>(load: () => Promise<Module>, name = 'default') {
  return lazy(later(() => load().then((m) => ({ default: m[name] as ComponentType<P> }))))
}

const files = {
  settings: () => import('./Settings'),
  statusViewer: () => import('./StatusViewer'),
  statusComposer: () => import('./StatusComposer'),
  callScreen: () => import('./CallScreen'),
  groupCallScreen: () => import('./GroupCallScreen'),
  callDialogs: () => import('./CallDialogs'),
  emoji: () => import('./EmojiPicker'),
  photoViewer: () => import('./PhotoViewer'),
  videoViewer: () => import('./VideoViewer'),
  photoEditor: () => import('./PhotoEditor'),
  videoNote: () => import('./VideoNoteRecorder'),
  onceViewer: () => import('./OnceViewer'),
}

export const Settings = screen<ComponentProps<typeof import('./Settings').default>>(files.settings)
export const StatusViewer = screen<ComponentProps<typeof import('./StatusViewer').default>>(files.statusViewer)
export const StatusComposer = screen<ComponentProps<typeof import('./StatusComposer').default>>(files.statusComposer)
export const CallScreen = screen<ComponentProps<typeof import('./CallScreen').default>>(files.callScreen)
export const GroupCallScreen = screen<ComponentProps<typeof import('./GroupCallScreen').default>>(files.groupCallScreen)
export const EmojiPicker = screen<ComponentProps<typeof import('./EmojiPicker').default>>(files.emoji)
export const PhotoViewer = screen<ComponentProps<typeof import('./PhotoViewer').default>>(files.photoViewer)
export const VideoViewer = screen<ComponentProps<typeof import('./VideoViewer').default>>(files.videoViewer)
export const PhotoEditor = screen<ComponentProps<typeof import('./PhotoEditor').default>>(files.photoEditor)
export const VideoNoteRecorder = screen<ComponentProps<typeof import('./VideoNoteRecorder').default>>(files.videoNote)
export const OnceViewer = screen<ComponentProps<typeof import('./OnceViewer').default>>(files.onceViewer)
type CallDialogs = typeof import('./CallDialogs')
export const StartCallDialog = screen<ComponentProps<CallDialogs['StartCallDialog']>>(files.callDialogs, 'StartCallDialog')
export const DialDialog = screen<ComponentProps<CallDialogs['DialDialog']>>(files.callDialogs, 'DialDialog')
export const CallLinkDialog = screen<ComponentProps<CallDialogs['CallLinkDialog']>>(files.callDialogs, 'CallLinkDialog')
export const ScheduleDialog = screen<ComponentProps<CallDialogs['ScheduleDialog']>>(files.callDialogs, 'ScheduleDialog')
export const CallReminder = screen<ComponentProps<CallDialogs['CallReminder']>>(files.callDialogs, 'CallReminder')
export const JoinCallDialog = screen<ComponentProps<CallDialogs['JoinCallDialog']>>(files.callDialogs, 'JoinCallDialog')

// Fetch them all quietly once PakChat has drawn and has a free moment.
// (Most important first: the call screen, so a call that comes in shows straight away.)
export function warmUp() {
  const go = () => {
    const order = [files.callScreen, files.groupCallScreen, files.emoji, files.photoViewer, files.videoViewer, files.onceViewer, files.statusViewer, files.statusComposer, files.callDialogs, files.settings, files.photoEditor, files.videoNote]
    order.reduce((before, load) => before.then(() => load().then(() => undefined, () => undefined)), Promise.resolve())
  }
  if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 4000 })
  else setTimeout(go, 1500)
}
