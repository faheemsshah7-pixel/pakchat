// tones.ts: PakChat's sounds that aren't calls.
//
// - Conversation tones: a soft "pop" when a message goes, and another when one
//   comes in while the chat is open (Settings › Notifications, with how loud).
// - Alert tones: each chat can have its own (chat info › Notification tone),
//   or follow the default. Android plays them itself (ChatAlerts.kt); here we
//   only play one so you can hear it while picking.
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { AppState } from 'react-native';

import { core } from './core';

/** The alert tones (the same names as ChatAlerts.TONES), plus '' (PakChat's own) and 'silent'. */
export const TONES = ['chime', 'bell', 'pop', 'drop', 'harp', 'soft'] as const;

/* eslint-disable @typescript-eslint/no-require-imports */
const FILES: Record<string, number> = {
  sent: require('../../assets/sounds/sent.wav'),
  received: require('../../assets/sounds/received.wav'),
  chime: require('../../assets/sounds/tones/pakchat_tone_chime.wav'),
  bell: require('../../assets/sounds/tones/pakchat_tone_bell.wav'),
  pop: require('../../assets/sounds/tones/pakchat_tone_pop.wav'),
  drop: require('../../assets/sounds/tones/pakchat_tone_drop.wav'),
  harp: require('../../assets/sounds/tones/pakchat_tone_harp.wav'),
  soft: require('../../assets/sounds/tones/pakchat_tone_soft.wav'),
};
/* eslint-enable @typescript-eslint/no-require-imports */

const players = new Map<string, AudioPlayer>();
/** Messages already chimed for, so a change to one (a tick, a reaction) doesn't chime again. */
const heard = new Set<string>();

function play(name: string, volume: number) {
  const file = FILES[name];
  if (file === undefined) return;
  try {
    let p = players.get(name);
    if (!p) {
      p = createAudioPlayer(file);
      players.set(name, p);
    }
    p.volume = Math.max(0, Math.min(1, volume));
    void p.seekTo(0).then(() => p.play());
  } catch {
    // No sound this time.
  }
}

/** A message went (from the open chat). */
export function sentTone(key: string) {
  if (heard.has(key)) return;
  heard.add(key);
  if (!core.settings.conversationTones || AppState.currentState !== 'active') return;
  play('sent', core.settings.toneVolume);
}

/** A message came into the chat that's open. */
export function receivedTone(key: string) {
  if (heard.has(key)) return;
  heard.add(key);
  if (heard.size > 500) heard.clear();
  if (!core.settings.conversationTones || AppState.currentState !== 'active') return;
  play('received', core.settings.toneVolume);
}

/** Plays an alert tone while picking one ('' is the phone's own, and 'silent', play nothing here). */
export function previewTone(tone: string, volume = 0.8) {
  if (tone && tone !== 'silent') play(tone, volume);
}

/** Plays the conversation tone at a loudness, while moving the slider. */
export function previewVolume(volume: number) {
  play('received', volume);
}
