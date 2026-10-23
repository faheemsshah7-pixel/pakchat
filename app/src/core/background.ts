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

TaskManager.defineTask(WAKE_TASK, async () => {
  try {
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
