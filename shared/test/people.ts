// Pretend people for the core's tests: each one is a PakChat client with its
// own storage and Signal keys, talking to the pretend server.

import { PakChat } from '../src/client';
import type { SignalApi } from '../src/signal';
import { MemoryStorage, type Message } from '../src/storage';
import { FakeServer } from './fakeServer';
import { type Kind, make } from './signals';

export type Person = {
  name: string;
  client: PakChat;
  signal: SignalApi;
  storage: MemoryStorage;
  id: string;
  deviceId: number;
};

export class World {
  server = new FakeServer();
  people: Person[] = [];
  /** Moves everyone's clock on (the server's and the phones'), in ms. */
  offset = 0;
  now = () => Date.now() + this.offset;

  constructor() {
    this.server.clock = this.now;
  }

  /** Signs someone up on their phone, and connects. */
  async person(name: string, kind: Kind = 'node'): Promise<Person> {
    const signal = make[kind]();
    const storage = new MemoryStorage();
    const client = new PakChat({ signal, storage, server: this.server.api(), connect: this.server.connect, deviceName: 'Phone', now: this.now });
    const s = await client.signIn(`google:${name}`);
    client.start();
    const p = { name, client, signal, storage, id: s.userId, deviceId: s.deviceId };
    this.people.push(p);
    await this.settle();
    return p;
  }

  /** Links a website to someone's phone (the QR code comes in phase 8). */
  async website(phone: Person, kind: Kind = 'wasm'): Promise<Person> {
    const signal = make[kind]();
    const storage = new MemoryStorage();
    const client = new PakChat({ signal, storage, server: this.server.api(), connect: this.server.connect, deviceName: 'Website', now: this.now });
    const s = await client.signInWith(async (device, keys) => this.server.link(phone.client.me!.token, device, keys));
    client.start();
    const p = { name: `${phone.name} (web)`, client, signal, storage, id: s.userId, deviceId: s.deviceId };
    this.people.push(p);
    await this.settle();
    return p;
  }

  /** Waits until nothing is moving: everything sent, delivered and handled. */
  async settle() {
    let quiet = 0;
    let last = '';
    for (let i = 0; i < 400 && quiet < 3; i++) {
      await new Promise((r) => setTimeout(r, 2));
      await Promise.all(this.people.map((p) => p.client.idle()));
      const outboxes = await Promise.all(this.people.map(async (p) => (await p.client.outbox()).filter((o) => o.notBefore <= Date.now()).length));
      const now = `${this.server.seen.length}/${[...this.server.pending.values()].map((l) => l.length).join(',')}/${outboxes.join(',')}`;
      quiet = now === last ? quiet + 1 : 0;
      last = now;
    }
  }

  nameOf(userId: string) {
    return this.people.find((p) => p.id === userId)?.name.replace(' (web)', '') ?? userId;
  }

  /** A chat's messages as "Name: text", oldest first. */
  async texts(p: Person, chatId: string) {
    const list = await p.client.messages(chatId, { limit: 1000 });
    return list.filter((m) => m.kind !== 'system').map((m) => this.line(m));
  }

  line(m: Message) {
    const who = this.nameOf(m.author);
    if (m.deleted) return `${who}: (deleted)`;
    if (m.kind === 'poll') return `${who}: poll ${m.poll!.question}`;
    return `${who}: ${m.text}${m.editedAt ? ' (edited)' : ''}`;
  }

  stop() {
    for (const p of this.people) p.client.stop();
  }
}
