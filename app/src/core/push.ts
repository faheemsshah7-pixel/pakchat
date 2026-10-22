// push.ts: alerts when PakChat is closed.
//
// The phone gets a token from Google's push service (FCM) and gives it to our
// server. When a message comes for a phone that isn't connected, the server asks
// Google to show "New message" on it. The alert never has names or words in it.
// Opening PakChat clears the alerts.
//
// This needs the app built with the Firebase file (app/google-services.json, see
// LEARN.md "Phase 5: alerts"). Without it there's no token, and everything else
// works as before.
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { AppState } from 'react-native';

import { core } from './core';

let started = false;

/** What the alerts can do on this phone right now. */
export type PushState = 'on' | 'blocked' | 'unavailable';
let state: PushState = 'unavailable';
export const pushState = () => state;

/** Sets up the "Messages" channel, asks permission once, and registers the token. Safe to call often. */
export async function startPush() {
  try {
    await Notifications.setNotificationChannelAsync('messages', {
      name: 'Messages',
      importance: AndroidImportance.HIGH,
      showBadge: true,
    });
    const asked = await Notifications.requestPermissionsAsync();
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
  }
  if (started) return;
  started = true;
  // A new token (Google changes them now and then) goes to the server too.
  Notifications.addPushTokenListener((t) => void core.savePushToken(String(t.data)).catch(() => {}));
  // While PakChat is open, messages show in the app, not as alerts.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false }),
  });
  clearAlerts();
  AppState.addEventListener('change', (s) => {
    if (s === 'active') clearAlerts();
  });
}

function clearAlerts() {
  void Notifications.dismissAllNotificationsAsync().catch(() => {});
}
