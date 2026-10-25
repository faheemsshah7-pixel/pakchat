// live.ts: sharing my live location, like WhatsApp: for 15 minutes, an hour or
// 8 hours. The message shows a map, and each move goes to the chat as a small
// locked change (client.moveLive), at most every 30 seconds or 25 metres.
//
// While it's on, Android shows "Sharing live location" with Stop
// (LiveLocation.kt). That also keeps PakChat running in the background so the
// phone keeps telling us where it is; each move then connects for a moment
// (core.briefly), since leaving PakChat lets go of the connection.
import type { Ref } from '@pakchat/shared';
import { LIVE_MAX_MS } from '@pakchat/shared';
import * as Location from 'expo-location';
import { AppState } from 'react-native';

import { fileModule } from '../../modules/pakchat-signal';
import { core } from './core';

export type Sharing = { chatId: string; ref: Ref; until: number };

export const LIVE_TIMES = [15 * 60_000, 60 * 60_000, LIVE_MAX_MS];

const KEY = 'app:live';
const EVERY_MS = 30_000;
const EVERY_M = 25;

let shares: Sharing[] = [];
let watcher: Location.LocationSubscription | null = null;
let last: { at: number; lat: number; lng: number } | null = null;
let words = { title: 'Sharing live location', text: '', stop: 'Stop' };
let listening = false;

/** Where I am now (asks for the location the first time). Null if it's not allowed or off. */
export async function whereAmI(): Promise<Location.LocationObject | null> {
  const asked = await Location.requestForegroundPermissionsAsync();
  if (!asked.granted) return null;
  try {
    return await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  } catch {
    return Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000 });
  }
}

/** A street and area for a place, from the phone (Android's own geocoder). */
export async function addressOf(lat: number, lng: number): Promise<{ name?: string; address?: string }> {
  try {
    const [a] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
    if (!a) return {};
    const street = [a.streetNumber, a.street].filter(Boolean).join(' ') || a.name || undefined;
    const address = [a.district ?? a.subregion, a.city, a.region].filter(Boolean).join(', ') || undefined;
    return { name: street ?? undefined, address };
  } catch {
    return {};
  }
}

export function sharing(chatId?: string) {
  return shares.filter((s) => !chatId || s.chatId === chatId);
}

/** Starts sharing in a chat: sends the live location message, then follows the phone. */
export async function startLive(chatId: string, forMs: number, alertWords: typeof words) {
  words = alertWords;
  const here = await whereAmI();
  if (!here) return false;
  const until = Date.now() + Math.min(forMs, LIVE_MAX_MS);
  const m = await core.client.sendLocation(chatId, { lat: here.coords.latitude, lng: here.coords.longitude, live: until });
  // Only one share per chat: a new one ends the old one.
  for (const old of shares.filter((s) => s.chatId === chatId)) await stopOne(old);
  shares = [...shares, { chatId, ref: { author: m.author, id: m.id }, until }];
  await save();
  last = { at: Date.now(), lat: here.coords.latitude, lng: here.coords.longitude };
  await follow();
  return true;
}

/** Stops sharing in one chat, or everywhere. */
export async function stopLive(chatId?: string) {
  for (const s of shares.filter((x) => !chatId || x.chatId === chatId)) await stopOne(s);
  if (!shares.length) unfollow();
}

/** On start: a share left from before (PakChat was closed) is ended properly. */
export async function resumeLive() {
  if (!listening) {
    listening = true;
    fileModule().addListener('liveStop', () => void stopLive());
  }
  shares = (await core.storage.getValue<Sharing[]>(KEY)) ?? [];
  const now = Date.now();
  for (const s of shares.filter((x) => x.until <= now)) await stopOne(s);
  if (shares.length) await follow();
}

async function stopOne(s: Sharing) {
  shares = shares.filter((x) => x !== s);
  await save();
  // It stays where it last was.
  const m = await core.storage.getMessage(s.chatId, s.ref.author, s.ref.id).catch(() => null);
  const at = last ?? (m?.location ? { lat: m.location.lat, lng: m.location.lng } : null);
  if (at) await send(s, at.lat, at.lng, true).catch(() => {});
}

async function save() {
  await core.storage.setValue(KEY, shares);
  core.emit('chats');
}

async function follow() {
  try {
    fileModule().liveLocationStart(words.title, words.text, words.stop);
  } catch {
    // The alert is a nicety; sharing still works while PakChat is open.
  }
  if (watcher) return;
  watcher = await Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, timeInterval: EVERY_MS, distanceInterval: EVERY_M }, (p) => void moved(p));
}

function unfollow() {
  watcher?.remove();
  watcher = null;
  try {
    fileModule().liveLocationStop();
  } catch {
    // Not showing.
  }
}

async function moved(p: Location.LocationObject) {
  const now = Date.now();
  for (const s of shares.filter((x) => x.until <= now)) await stopOne(s);
  if (!shares.length) return unfollow();
  const lat = p.coords.latitude;
  const lng = p.coords.longitude;
  if (last && now - last.at < EVERY_MS && metres(last, { lat, lng }) < EVERY_M) return;
  last = { at: now, lat, lng };
  for (const s of shares) await send(s, lat, lng, false).catch(() => {});
}

async function send(s: Sharing, lat: number, lng: number, stop: boolean) {
  if (AppState.currentState === 'active') return core.client.moveLive(s.chatId, s.ref, lat, lng, stop);
  // In the background: connect for a moment to send it.
  await core.briefly(false, async () => {
    await core.client.moveLive(s.chatId, s.ref, lat, lng, stop);
  });
}

function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}
