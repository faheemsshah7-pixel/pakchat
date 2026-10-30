// linking.ts: Linked devices, like WhatsApp's. The phone scans the QR on the
// PakChat website, and the website becomes one of this account's devices
// (up to 4). Then the phone copies its chats over, newest first, so the
// website can be used even with the phone switched off.
//
// How it stays private (details in shared/src/link.ts and history.ts):
//   - the QR carries a check of the website's keys, so the server can't swap them;
//   - what the phone tells the website is locked to a key that's only in the QR;
//   - the chat history is locked like any file, and its key goes to the website
//     alone inside a Signal message.
import { approvePairing, approveQr, exportHistory, fromBytes, LinkRefused, type LinkedDevice, pairExtra, type Provision, toBytes } from '@pakchat/shared';
import { AESEncryptionKey, AESSealedData, aesDecryptAsync } from 'expo-crypto';
import * as Device from 'expo-device';
import { File, Paths } from 'expo-file-system';
import KV from 'expo-sqlite/kv-store';

import { fileModule } from '../../modules/pakchat-signal';
import { core } from './core';
import { listen, stopped } from './files';

export { LinkRefused };

/** The app's own lists a website needs too: names, saved contacts, chat settings, starred, lists. */
const VALUES = ['app:people', 'app:contacts', 'app:ways', 'app:prefs', 'app:starred', 'app:lists', 'app:lockCode'];

/** Websites the phone is copying chats to right now (device id), for "Syncing…" on the list. */
export const syncing = new Set<number>();

export function linkedDevices(): Promise<LinkedDevice[]> {
  return core.server.linkedDevices();
}

export async function logOutDevice(deviceId: number) {
  await core.server.removeDevice(deviceId);
  owe(deviceId, null);
  // The next website linked may get this number: don't lock anything for this one again.
  await core.client.forgetMyDevice(deviceId).catch(() => {});
  core.emit('devices');
}

/**
 * Links the website whose QR was just scanned. Throws LinkRefused (not a
 * PakChat QR, ran out, keys don't match, already 4 devices). Copies the
 * chats over afterwards, without waiting.
 */
export async function linkFromQr(text: string): Promise<{ deviceId: number; name: string }> {
  const me = core.client.me;
  if (!me) throw new Error('Not signed in');
  const provision: Provision = { v: 1, userId: me.userId, identityKey: await core.client.myIdentityKey(), phoneName: Device.modelName ?? 'Android phone' };
  const fm = fileModule();
  const linked = await approveQr(core.server, text, provision, (p, key) => fm.lockProvision(JSON.stringify(p), fromBytes(key)));
  if (!linked) throw new LinkRefused('expired');
  await linkedNew(linked.deviceId);
  return linked;
}

/**
 * "Link with phone number instead": the 8-letter code the website shows.
 * Finds the website waiting for my number that the code opens (see
 * shared/src/link.ts), then links it just like a scanned QR. Throws
 * LinkRefused, also "wrong_code" and "no_phone".
 */
export async function linkFromCode(typed: string): Promise<{ deviceId: number; name: string }> {
  const me = core.client.me;
  if (!me) throw new Error('Not signed in');
  const provision: Provision = { v: 1, userId: me.userId, identityKey: await core.client.myIdentityKey(), phoneName: Device.modelName ?? 'Android phone' };
  const fm = fileModule();
  // The key is slow to make on purpose: once, then it tries every waiting website.
  let key: { phone: string; key: AESEncryptionKey } | null = null;
  const open = async (sealed: string, code: string, phone: string) => {
    if (key?.phone !== phone) key = { phone, key: await AESEncryptionKey.import(toBytes(await fm.backupKey(code, `pair:${phone}`)).slice(0, 32)) };
    try {
      const bytes = toBytes(sealed);
      const plain = await aesDecryptAsync(AESSealedData.fromParts(bytes.slice(0, 12), bytes.slice(12), 16), key.key, { additionalData: pairExtra(phone) });
      // A QR text is plain ASCII.
      return String.fromCharCode(...plain);
    } catch {
      return null;
    }
  };
  const linked = await approvePairing(core.server, typed, provision, (p, k) => fm.lockProvision(JSON.stringify(p), fromBytes(k)), open);
  await linkedNew(linked.deviceId);
  return linked;
}

/**
 * A website was just linked. It often gets the number of one logged out before,
 * and the phone may still hold that old website's lock: forget it, so the chats
 * are locked for this one. Then copy them over, without waiting.
 */
async function linkedNew(deviceId: number) {
  owe(deviceId, null);
  await core.client.forgetMyDevice(deviceId);
  core.emit('devices');
  void sendHistory(deviceId).catch((err: unknown) => console.log(`[pakchat] history: ${String(err)}`));
}

/** Copies still owed to a website (device id → the next part to send), kept until done. */
const PENDING = 'history:pending';
const pending = (): Record<string, number> => {
  try {
    return JSON.parse(KV.getItemSync(PENDING) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
};
function owe(deviceId: number, next: number | null) {
  const now = pending();
  if (next === null) delete now[deviceId];
  else now[deviceId] = next;
  KV.setItemSync(PENDING, JSON.stringify(now));
}

/**
 * Picks up a copy that stopped part way (the phone was locked, PakChat closed, or the
 * internet went), from the part it got to. Run when PakChat opens or comes back.
 */
export async function resumeHistory() {
  const owed = Object.entries(pending()).filter(([id]) => !syncing.has(Number(id)));
  if (!owed.length) return;
  const linked = new Set((await linkedDevices()).map((d) => d.deviceId));
  for (const [id, next] of owed) {
    const deviceId = Number(id);
    // Logged out meanwhile: nothing more to send it.
    if (!linked.has(deviceId)) owe(deviceId, null);
    else void sendHistory(deviceId, next).catch((err: unknown) => console.log(`[pakchat] history: ${String(err)}`));
  }
}

/** Copies this phone's chats to a linked device, in parts, through my "Message yourself" chat. */
async function sendHistory(deviceId: number, from = 1) {
  if (syncing.has(deviceId)) return;
  syncing.add(deviceId);
  owe(deviceId, from);
  core.emit('devices');
  const fm = fileModule();
  listen();
  // The connection stays up while copying, even if PakChat goes to the background.
  core.hold();
  try {
    const self = await core.client.openDirect(core.myId);
    const parts = await exportHistory(core.storage, { valueKeys: VALUES });
    for (const part of parts) {
      if (part.part < from) continue;
      const file = new File(Paths.cache, `pakchat-history-${deviceId}-${part.part}.json`);
      if (file.exists) file.delete();
      file.create();
      await file.write(JSON.stringify(part));
      const tag = `history/${deviceId}/${part.part}`;
      try {
        const { id, uploadUrl } = await core.server.startUpload(self.id, fm.lockedSize(file.size));
        const up = await fm.uploadFile(file.uri, uploadUrl, null, tag);
        await core.client.sendHistory(self.id, deviceId, { part: part.part, last: part.part === parts.length, file: { id, key: up.key, digest: up.digest, size: up.size } });
      } finally {
        if (file.exists) file.delete();
        stopped(tag);
      }
      owe(deviceId, part.part + 1);
    }
    owe(deviceId, null);
  } finally {
    syncing.delete(deviceId);
    core.release();
    core.emit('devices');
  }
}

