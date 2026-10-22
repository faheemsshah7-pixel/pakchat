// push.ts: alerts, like WhatsApp's.
//
// The phone gets a token from Google's push service (FCM) and gives it to our
// server. When a message comes for a phone that isn't connected, the server
// sends a quiet wake-up through Google: no words in it, just "come and get it".
// The phone wakes PakChat in the background (background.ts), which connects,
// collects the message (so the sender sees grey double ticks), and shows the
// alert itself: the chat's name and what the message says. Only this phone
// ever sees the words; Google and our server never do.
//
// One alert per chat. A new message replaces it, with "3 new messages" on top.
// Opening the chat clears it, and tapping it opens the chat.
//
// This needs the app built with the Firebase file (app/google-services.json, see
// LEARN.md "Phase 5: alerts"). Without it there's no token, and everything else
// works as before.
import type { Message } from '@pakchat/shared';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import KV from 'expo-sqlite/kv-store';
import { AppState } from 'react-native';

import { en, fill, ur, type Strings } from '../i18n/strings';
import { preview } from '../ui/format';
import { core } from './core';

/** The background task the wake-ups run (defined in background.ts). */
export const WAKE_TASK = 'pakchat-wake';
const CHANNEL = 'messages';
/** The plain "New message" alert, for when a wake-up couldn't reach the server. */
const PLAIN = 'pakchat:new';

let started = false;

/** What the alerts can do on this phone right now. */
export type PushState = 'on' | 'blocked' | 'unavailable';
let state: PushState = 'unavailable';
export const pushState = () => state;

// Our own alerts show even while PakChat is open (for chats you're not looking at).
// The quiet wake-ups have nothing to show.
Notifications.setNotificationHandler({
  handleNotification: async (n) => {
    const ours = typeof n.request.content.data?.chatId === 'string' || n.request.identifier === PLAIN;
    return { shouldShowBanner: ours, shouldShowList: ours, shouldPlaySound: ours, shouldSetBadge: false };
  },
});

/** Sets up the "Messages" channel, asks permission once, and registers the token. Safe to call often. */
export async function startPush() {
  try {
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: 'Messages',
      importance: AndroidImportance.HIGH,
      showBadge: true,
    });
    // The wake-ups run this task, even when PakChat is closed.
    await Notifications.registerTaskAsync(WAKE_TASK);
    // Only ask while you're looking: never from the background.
    const asked = AppState.currentState === 'active' ? await Notifications.requestPermissionsAsync() : await Notifications.getPermissionsAsync();
    if (!asked.granted) {
      state = 'blocked';
      return;
    }
    const token = await Notifications.getDevicePushTokenAsync();
    await core.savePushToken(String(token.data));
    state = 'on';
  } catch (err) {
    // No Firebase file in this build, or offline: try again next start.
    console.log(`[pakchat] push: ${String(err)}`);
    if (state !== 'blocked') state = 'unavailable';
  } finally {
    if (!started) {
      started = true;
      // A new token (Google changes them now and then) goes to the server too.
      Notifications.addPushTokenListener((t) => void core.savePushToken(String(t.data)).catch(() => {}));
      // Opening PakChat: the plain "New message" alert has done its job.
      dismissPlain();
      AppState.addEventListener('change', (s) => {
        if (s === 'active') dismissPlain();
      });
    }
  }
}

/** The words in the language you chose (read straight from the saved look, so it works in the background). */
function words(): Strings {
  try {
    const saved = KV.getItemSync('prefs.look');
    return saved && (JSON.parse(saved) as { lang?: string }).lang === 'ur' ? ur : en;
  } catch {
    return en;
  }
}

// Alerts are made one at a time, so two quick messages count as two.
let line: Promise<unknown> = Promise.resolve();
const inLine = (work: () => Promise<void>) => {
  line = line.then(work, work).catch((err: unknown) => console.log(`[pakchat] alert: ${String(err)}`));
  return line;
};

/** How many messages each chat's alert stands for. */
type Counts = Record<string, number>;
const COUNTS = 'app:alertCounts';

const alertId = (chatId: string) => `chat:${chatId}`;

/**
 * A message from someone else just arrived: alert, unless the chat is muted,
 * you're looking at it, or it's an old one caught up while PakChat is open
 * (those just show in the chat list).
 */
export function alertFor(m: Message) {
  if (m.kind === 'system' || m.deleted || m.author === core.myId) return;
  if (core.prefs[m.chatId]?.muted) return;
  const open = AppState.currentState === 'active';
  if (open && (core.viewing === m.chatId || Date.now() - m.sentAt > 120_000)) return;
  void inLine(async () => {
    const chat = await core.storage.getChat(m.chatId);
    if (!chat) return;
    const t = words();
    const id = alertId(m.chatId);
    // Still showing? Then this message adds to it. Swiped away? Start again at one.
    const showing = (await Notifications.getPresentedNotificationsAsync()).some((n) => n.request.identifier === id);
    const counts = (await core.storage.getValue<Counts>(COUNTS)) ?? {};
    const n = (showing ? (counts[m.chatId] ?? 0) : 0) + 1;
    await core.storage.setValue(COUNTS, { ...counts, [m.chatId]: n });
    await Notifications.scheduleNotificationAsync({
      identifier: id,
      content: {
        title: core.chatTitle(chat) || t.newMessage,
        // In a group, who said it comes first: "Sara: See you at 5".
        body: preview(m, t, chat.kind === 'group') || t.newMessage,
        subtitle: n > 1 ? fill(t.newMessages, { n }) : undefined,
        data: { chatId: m.chatId },
        priority: Notifications.AndroidNotificationPriority.HIGH,
      },
      trigger: { channelId: CHANNEL },
    });
  });
}

/** You've seen the chat: its alert goes, and its count starts again. */
export function dismissChatAlert(chatId: string) {
  return inLine(async () => {
    await Notifications.dismissNotificationAsync(alertId(chatId));
    const counts = (await core.storage.getValue<Counts>(COUNTS)) ?? {};
    if (!(chatId in counts)) return;
    delete counts[chatId];
    await core.storage.setValue(COUNTS, counts);
  });
}

/** A wake-up came but the server couldn't be reached: say there's something, without the words. */
export async function alertPlain() {
  const t = words();
  await Notifications.scheduleNotificationAsync({
    identifier: PLAIN,
    content: { title: 'PakChat', body: t.newMessage, priority: Notifications.AndroidNotificationPriority.HIGH },
    trigger: { channelId: CHANNEL },
  }).catch(() => {});
}

function dismissPlain() {
  void Notifications.dismissNotificationAsync(PLAIN).catch(() => {});
}
