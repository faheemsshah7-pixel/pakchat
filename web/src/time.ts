// time.ts: small helpers for showing times, and a clock that ticks.
// `locale` says how to write dates: [] = your computer's default, ['ur-PK'] = Urdu.
import { useEffect, useState } from 'react'
import type { Timestamp } from 'firebase/firestore'
import { fill, type Strings } from './strings'

// Today: "1:43 PM". Older: "12 Oct".
export function formatTime(date: Date | undefined, locale: string[]) {
  if (!date) return ''
  return isToday(date) ? clock(date, locale) : shortDate(date, locale)
}

export function clock(date: Date, locale: string[]) {
  return date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
}

export function shortDate(date: Date, locale: string[]) {
  return date.toLocaleDateString(locale, { day: 'numeric', month: 'short' })
}

export function isToday(date: Date) {
  return date.toDateString() === new Date().toDateString()
}

// Which day a time falls on (by this device's calendar), as a plain number, quick to compare.
// A chat compares every message with the one before it, so this needs to be fast.
export function dayNumber(time: Timestamp | null | undefined) {
  if (!time) return undefined
  const ms = time.toMillis()
  return Math.floor((ms - new Date(ms).getTimezoneOffset() * 60_000) / 86_400_000)
}

export function isYesterday(date: Date) {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  return date.toDateString() === yesterday.toDateString()
}

// 75 seconds -> "1:15"
export function duration(seconds: number) {
  const s = Math.max(0, Math.round(seconds))
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
}

// The current time, updated every `everyMs` milliseconds.
// Screens use it so "typing…" and "online" disappear by themselves when they get old.
export function useNow(everyMs: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs)
    return () => clearInterval(timer)
  }, [everyMs])
  return now
}

// For lists like Calls: today "2:30 PM", then "Yesterday", "Wednesday" (this week), or "12 Oct".
export function dayOrTime(date: Date | undefined, locale: string[], yesterday: string) {
  if (!date) return ''
  if (isToday(date)) return clock(date, locale)
  if (isYesterday(date)) return yesterday
  if (Date.now() - date.getTime() < 6 * 86_400_000) return date.toLocaleDateString(locale, { weekday: 'long' })
  return shortDate(date, locale)
}

// "Today", "Yesterday", or a date like "12 October 2026" (the labels between days in a chat).
export function dayLabel(date: Date | undefined, t: Strings) {
  if (!date) return ''
  if (isToday(date)) return t.today
  if (isYesterday(date)) return t.yesterday
  return date.toLocaleDateString(t.locale, { day: 'numeric', month: 'long', year: 'numeric' })
}

// "Fri 17 Oct, 3:00 PM": a day and time that might be in the future (scheduled calls).
export function dayAndTime(date: Date, locale: string[]) {
  return `${date.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })}, ${clock(date, locale)}`
}

// For statuses: "Just now", "5 minutes ago", "Today, 2:30 PM", "Yesterday, 11:05 PM".
export function agoText(date: Date | undefined, now: number, t: Strings) {
  if (!date) return t.justNow
  const minutes = Math.floor((now - date.getTime()) / 60_000)
  if (minutes < 1) return t.justNow
  if (minutes < 60) return fill(minutes === 1 ? t.minuteAgo : t.minutesAgo, { n: minutes })
  return `${isToday(date) ? t.today : t.yesterday}, ${clock(date, t.locale)}`
}
