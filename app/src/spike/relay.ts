// A pretend server that lives inside the app, for the spike only.
//
// It behaves like the real Phoenix server will in phase 2: it only relays.
// It hands out public keys, pushes envelopes to devices that are online, holds
// them for devices that are offline, and deletes each one once the device says
// "got it". It never sees a message's words, only who it's for.

import type { Bundle, Sealed } from './types';

/** What the server sees: who it's from, who it's for, and locked bytes. */
export type Envelope = {
  id: number;
  from: string;
  fromDevice: number;
  to: string;
  toDevice: number;
  /** 'direct' is 1-to-1. 'group' is a group message, copied to each member. */
  kind: 'direct' | 'group';
  groupId?: string;
  sealed: Sealed;
};

type Listener = (envelope: Envelope) => void;

const key = (name: string, deviceId: number) => `${name}:${deviceId}`;

export class Relay {
  private nextId = 1;
  /** Like the `pending_envelopes` table: waiting until the device confirms. */
  private pending = new Map<string, Envelope[]>();
  private online = new Map<string, Listener>();
  /** Public keys only. Each bundle is handed out once. */
  private bundles = new Map<string, Bundle[]>();
  /** Every envelope that ever passed through, so tests can check what the server saw. */
  readonly seen: Envelope[] = [];

  publishBundles(name: string, deviceId: number, bundles: Bundle[]) {
    const k = key(name, deviceId);
    this.bundles.set(k, [...(this.bundles.get(k) ?? []), ...bundles]);
  }

  /** Gives out one bundle and removes it, as the server does with one-time keys. */
  takeBundle(name: string, deviceId: number): Bundle {
    const bundle = this.bundles.get(key(name, deviceId))?.shift();
    if (!bundle) throw new Error(`${name} has no keys left on the server`);
    return bundle;
  }

  /** A device connects. Everything waiting for it is pushed, oldest first. */
  connect(name: string, deviceId: number, listener: Listener) {
    const k = key(name, deviceId);
    this.online.set(k, listener);
    for (const envelope of [...(this.pending.get(k) ?? [])]) listener(envelope);
  }

  disconnect(name: string, deviceId: number) {
    this.online.delete(key(name, deviceId));
  }

  isOnline(name: string, deviceId: number) {
    return this.online.has(key(name, deviceId));
  }

  /** Stores the envelope, and pushes it straight away if the device is online. */
  send(envelope: Omit<Envelope, 'id'>) {
    const full: Envelope = { ...envelope, id: this.nextId++ };
    const k = key(full.to, full.toDevice);
    this.pending.set(k, [...(this.pending.get(k) ?? []), full]);
    this.seen.push(full);
    this.online.get(k)?.(full);
    return full;
  }

  /** Pushes the same envelope again, as a weak network sometimes does. */
  resend(envelope: Envelope) {
    this.online.get(key(envelope.to, envelope.toDevice))?.(envelope);
  }

  /** The device has it, so the server deletes it. */
  ack(name: string, deviceId: number, envelopeId: number) {
    const k = key(name, deviceId);
    this.pending.set(k, (this.pending.get(k) ?? []).filter((e) => e.id !== envelopeId));
  }

  pendingFor(name: string, deviceId: number) {
    return this.pending.get(key(name, deviceId))?.length ?? 0;
  }
}
