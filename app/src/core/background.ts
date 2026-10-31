// background.ts: what PakChat does without any screens.
//
// - A wake-up from the server (the app may be closed): collect what's waiting.
//   Android starts the app's JavaScript, runs this, and puts it away again.
// - Reply, Mark as read or Mute pressed on a message alert (ChatAlerts.kt).
// - Decline or Hang up pressed on a call's alert (CallAlerts.kt).
//
// Both have to be set up before anything else loads, so index.ts (the app's
// entry) imports this first.
import * as TaskManager from 'expo-task-manager';
import { AppRegistry } from 'react-native';

import { calls } from './calls';
import { core } from './core';
import { alertPlain, dismissChatAlert, WAKE_TASK } from './push';
import { onAlarm } from './scheduled';

/** The locked messages a push brought along (see the server's Push.Fcm), as JSON text. */
function lockedIn(payload: unknown): string | null {
  const p = payload as { data?: Record<string, unknown> } | undefined;
  const d = p?.data;
  const inner = d?.data as Record<string, unknown> | undefined;
  const env = inner?.env ?? d?.env;
  return typeof env === 'string' ? env : null;
}

TaskManager.defineTask(WAKE_TASK, async ({ data }) => {
  try {
    // Like WhatsApp: the newest messages came in the push itself, still locked.
    // Open them and show the alert now, before connecting.
    const env = lockedIn({ data });
    if (env) await core.fromPush(env).catch((err: unknown) => console.log(`[pakchat] push messages: ${String(err)}`));
    // Connect, collect what's waiting (the alerts show as each message is opened), let go.
    if (!(await core.collect())) await alertPlain();
  } catch (err) {
    console.log(`[pakchat] wake: ${String(err)}`);
    await alertPlain();
  }
});

type AlertAction = { action: 'reply' | 'read' | 'mute'; chatId: string; text?: string };

AppRegistry.registerHeadlessTask('PakchatAlertAction', () => async ({ action, chatId, text }: AlertAction) => {
  try {
    await core.onAlert(action, chatId, text ?? '');
  } catch (err) {
    console.log(`[pakchat] alert action: ${String(err)}`);
  } finally {
    await dismissChatAlert(chatId);
  }
});

type CallAction = { action: 'decline' | 'hangup'; callId: string; chatId: string };

AppRegistry.registerHeadlessTask('PakchatCallAction', () => async ({ action, callId }: CallAction) => {
  try {
    await calls.onAction(action, callId);
  } catch (err) {
    console.log(`[pakchat] call action: ${String(err)}`);
  }
});

// A scheduled message's time came (Scheduled.kt): send what's due.
AppRegistry.registerHeadlessTask('PakchatScheduled', () => async () => {
  try {
    await onAlarm();
  } catch (err) {
    console.log(`[pakchat] scheduled: ${String(err)}`);
  }
});
