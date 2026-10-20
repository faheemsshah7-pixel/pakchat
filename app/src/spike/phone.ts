// One pretend phone in the spike. It has its own Signal keys (inside the
// library), talks to the relay, and keeps the messages it has read.

import type { Envelope, Relay } from './relay';
import type { SignalApi } from './types';

/** What travels inside a 1-to-1 encrypted message. */
type Content =
  | { t: 'text'; text: string }
  | { t: 'groupKey'; groupId: string; groupKey: string };

export type Received = {
  from: string;
  text: string;
  groupId?: string;
  envelopeId: number;
};

export class Phone {
  readonly deviceId = 1;
  handle = '';
  inbox: Received[] = [];
  errors: string[] = [];

  private done = new Set<number>();
  /** Envelopes are handled one by one, in order, like a real phone's queue. */
  private queue: Promise<void> = Promise.resolve();
  /** Groups this phone has already sent its own group key to. */
  private sharedKeyWith = new Map<string, Set<string>>();
  /** Lets the screen redraw when something changes. */
  onChange: () => void = () => {};

  constructor(
    private api: SignalApi,
    private relay: Relay,
    readonly name: string,
  ) {}

  /** Makes this phone's keys and puts a few one-time bundles on the server. */
  async setup(bundles = 5) {
    this.handle = await this.api.createDevice(this.name, this.deviceId);
    const list = [];
    for (let i = 0; i < bundles; i++) list.push(await this.api.newBundle(this.handle));
    this.relay.publishBundles(this.name, this.deviceId, list);
  }

  get online() {
    return this.relay.isOnline(this.name, this.deviceId);
  }

  connect() {
    this.relay.connect(this.name, this.deviceId, (e) => this.receive(e));
    this.onChange();
  }

  disconnect() {
    this.relay.disconnect(this.name, this.deviceId);
    this.onChange();
  }

  /** Resolves once every envelope that has arrived so far is handled. */
  idle() {
    return this.queue;
  }

  /** Makes sure we have a session with someone, fetching their keys from the server if not. */
  private async session(to: string) {
    if (!(await this.api.hasSession(this.handle, to, 1))) {
      const bundle = this.relay.takeBundle(to, 1);
      await this.api.startSession(this.handle, to, 1, bundle);
    }
  }

  private async sendDirect(to: string, content: Content) {
    await this.session(to);
    const sealed = await this.api.encrypt(this.handle, to, 1, JSON.stringify(content));
    return this.relay.send({ from: this.name, fromDevice: this.deviceId, to, toDevice: 1, kind: 'direct', sealed });
  }

  /** Sends a 1-to-1 message. */
  sendText(to: string, text: string) {
    return this.sendDirect(to, { t: 'text', text });
  }

  /**
   * Sends a group message. The first time, this phone's group key goes to every
   * member inside a normal 1-to-1 message. Then the message is locked once and
   * the server copies it to each member.
   */
  async sendGroup(groupId: string, members: string[], text: string) {
    const others = members.filter((m) => m !== this.name);
    const shared = this.sharedKeyWith.get(groupId) ?? new Set<string>();
    const needKey = others.filter((m) => !shared.has(m));
    if (needKey.length) {
      const groupKey = await this.api.createGroupKey(this.handle, groupId);
      for (const m of needKey) {
        await this.sendDirect(m, { t: 'groupKey', groupId, groupKey });
        shared.add(m);
      }
      this.sharedKeyWith.set(groupId, shared);
    }

    const body = await this.api.groupEncrypt(this.handle, groupId, text);
    // type 7 is Signal's "sender key" message type.
    return others.map((to) =>
      this.relay.send({
        from: this.name,
        fromDevice: this.deviceId,
        to,
        toDevice: 1,
        kind: 'group',
        groupId,
        sealed: { type: 7, body },
      }),
    );
  }

  private receive(envelope: Envelope) {
    this.queue = this.queue.then(() => this.process(envelope));
  }

  private async process(e: Envelope) {
    // Already handled (the server sent it twice): just confirm again.
    if (this.done.has(e.id)) {
      this.relay.ack(this.name, this.deviceId, e.id);
      return;
    }
    try {
      if (e.kind === 'direct') {
        const content = JSON.parse(await this.api.decrypt(this.handle, e.from, e.fromDevice, e.sealed)) as Content;
        if (content.t === 'groupKey') {
          await this.api.acceptGroupKey(this.handle, e.from, e.fromDevice, content.groupKey);
        } else {
          this.inbox.push({ from: e.from, text: content.text, envelopeId: e.id });
        }
      } else {
        const text = await this.api.groupDecrypt(this.handle, e.from, e.fromDevice, e.sealed.body);
        this.inbox.push({ from: e.from, text, groupId: e.groupId, envelopeId: e.id });
      }
      this.done.add(e.id);
      // Only now, safely read, does the server get to delete it.
      this.relay.ack(this.name, this.deviceId, e.id);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'ERR_DUPLICATE') {
        this.done.add(e.id);
        this.relay.ack(this.name, this.deviceId, e.id);
      } else {
        // Not confirmed, so the server keeps it and we can try again later.
        this.errors.push(`${e.from} → ${this.name} #${e.id}: ${(err as Error).message}`);
      }
    }
    this.onChange();
  }
}
