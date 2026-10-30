// phone.ts: is this an older or smaller phone?
//
// Some drawing that looks nice costs a lot on a slower phone: a colour fade
// inside every one of my message bubbles, for one. On a phone with little
// memory, or an Android older than 12, PakChat draws those more simply (a
// plain colour), so scrolling stays smooth. Faster phones get the full look.
import * as Device from 'expo-device';
import { Platform } from 'react-native';

const GB = 1024 * 1024 * 1024;

function isSlow() {
  if (Platform.OS !== 'android') return false;
  const android = typeof Platform.Version === 'number' ? Platform.Version : 99;
  const memory = Device.totalMemory ?? 8 * GB;
  return android < 31 || memory < 4.5 * GB;
}

/** True on an older or smaller phone: draw the simpler way. */
export const slowPhone = isSlow();
