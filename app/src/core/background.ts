// background.ts: what PakChat does when a wake-up arrives from the server.
//
// It runs even when PakChat is closed: Android starts the app's JavaScript
// without any screens, runs this, and puts it away again. It has to be set up
// before anything else loads, so index.ts (the app's entry) imports it first.
import * as TaskManager from 'expo-task-manager';

import { core } from './core';
import { alertPlain, WAKE_TASK } from './push';

TaskManager.defineTask(WAKE_TASK, async () => {
  try {
    // Connect, collect what's waiting (the alerts show as each message is opened), let go.
    if (!(await core.collect())) await alertPlain();
  } catch (err) {
    console.log(`[pakchat] wake: ${String(err)}`);
    await alertPlain();
  }
});
