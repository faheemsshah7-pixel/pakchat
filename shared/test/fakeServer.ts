// A pretend Phoenix server that lives in the test, so the core's tests run in
// a second, with no Elixir or Postgres. It follows the real server's rules
// (server/lib/pakchat/relay.ex): who may send, "stale devices", groups,
// receipts, holding envelopes until they're confirmed.
//
// It can also misbehave on purpose, like a weak network: send things twice,
// or in a jumbled order. test/e2e runs the same kind of checks against the
// real server.

import type { Connection, ConnectionFactory, ConnectionHandlers, WireEnvelope } from '../src/connection';
import type { Me, ServerApi, ServerChat, SignedIn } from '../src/server';
import { OfflineError, ServerError } from '../src/server';
import type { Bundle, DeviceKeys, OneTimeKey, PreKeys, SignedKey } from '../src/signal';
import type { Role } from '../src/storage';

type User = { id: string; name: string; email: string | null; phone?: string };
type Device = { uuid: string; userId: string; deviceId: number; token: string; keys: DeviceKeys; ec: OneTimeKey[]; kyber: SignedKey[] };
type FakeChat = { id: string; kind: 'direct' | 'group' | 'status'; members: { userId: string; role: Role }[]; seq: number; title?: string; onlyAdminsSend?: boolean; owner?: string };
type Sealed = { user_id: string; device_id: number; type: number; body: string };

const uuid = () => crypto.randomUUID();
const tick = () => new Promise((r) => setTimeout(r, 0));

export const FAKE_CODE = '123456';

export class FakeServer {
  users = new Map<string, User>();
  devices: Device[] = [];
  chats = new Map<string, FakeChat>();
  pending = new Map<string, WireEnvelope[]>();
  online = new Map<string, ConnectionHandlers>();
  /** Every locked envelope that ever passed through, so tests can check what the server saw. */
  seen: WireEnvelope[] = [];
  /** Every call message sent: which chat, from whom, did it ring, to how many devices. */
  calls: { chatId: string; from: string; ring: boolean; to: number }[] = [];
  /** Misbehave like a weak network (or a server that's up to no good). */
  chaos: { duplicate?: boolean; shuffle?: boolean; reverse?: boolean; rewrite?: (e: WireEnvelope) => WireEnvelope } = {};
  /** The server's clock, so tests can move time on. */
  clock = () => Date.now();
  private nextId = 1;

  // ---- Helpers for tests ----

  userByName(name: string) {
    const u = [...this.users.values()].find((x) => x.name === name);
    if (!u) throw new Error(`No user ${name}`);
    return u;
  }

  pendingFor(userId: string, deviceId: number) {
    const d = this.devices.find((x) => x.userId === userId && x.deviceId === deviceId);
    return d ? (this.pending.get(d.uuid) ?? []).length : 0;
  }

  /** Links a new device (like a website scanning the QR code). */
  link(phoneToken: string, keys: DeviceKeys & { name: string }, pre: PreKeys): SignedIn {
    const phone = this.byToken(phoneToken);
    const taken = this.devices.filter((d) => d.userId === phone.userId).map((d) => d.deviceId);
    const deviceId = [2, 3, 4, 5, 6].find((n) => !taken.includes(n));
    if (!deviceId) throw new ServerError('too_many_devices');
    const d = this.addDevice(phone.userId, deviceId, keys, pre);
    return { token: d.token, user: this.me(phone.userId), deviceId, deviceUuid: d.uuid };
  }

  // ---- What a device can reach ----

  api(): ServerApi {
    let token: string | null = null;
    const who = () => {
      if (!token) throw new ServerError('unauthorized', 401);
      return this.byToken(token);
    };
    const call = async <T>(run: () => T): Promise<T> => {
      await tick();
      return run();
    };
    return {
      useToken: (t) => {
        token = t;
      },
      signIn: (idToken, device, keys) => call(() => this.signIn(idToken, device, keys)),
      signInWithPhone: (phone, code, device, keys) => call(() => this.signInWithPhone(phone, code, device, keys)),
      signOut: () => call(() => void this.devices.splice(this.devices.indexOf(who()), 1)),
      keyCounts: () => call(() => ({ ec: who().ec.length, kyber: who().kyber.length })),
      uploadKeys: (keys) =>
        call(() => {
          const d = who();
          d.ec.push(...keys.preKeys);
          d.kyber.push(...keys.kyberPreKeys);
        }),
      devices: (userId) => call(() => this.devicesOf(userId).map((d) => d.deviceId)),
      bundles: (userId, ids) => call(() => this.bundles(userId, ids)),
      chats: () => call(() => [...this.chats.values()].filter((c) => this.isMember(c, who().userId)).map((c) => this.wireChat(c, who().userId))),
      chat: (id) => call(() => this.wireChat(this.memberChat(who().userId, id), who().userId)),
      openDirect: (userId) => call(() => this.wireChat(this.openDirect(who().userId, userId))),
      createGroup: (title, ids, options) => call(() => this.wireChat(this.createGroup(who().userId, title, ids, options?.onlyAdminsSend))),
      addMembers: (id, ids) =>
        call(() => {
          const chat = this.adminChat(who().userId, id);
          const fresh = ids.filter((u) => !this.isMember(chat, u));
          chat.members.push(...fresh.map((userId) => ({ userId, role: 'member' as Role })));
          if (fresh.length) this.note(chat, who().userId, { event: 'added', users: fresh });
          return this.wireChat(chat);
        }),
      removeMember: (id, userId) =>
        call(() => {
          const me = who().userId;
          const chat = me === userId ? this.memberChat(me, id) : this.adminChat(me, id);
          chat.members = chat.members.filter((m) => m.userId !== userId);
          this.note(chat, me, { event: me === userId ? 'left' : 'removed', users: [userId] }, [userId]);
        }),
      setAdmin: (id, userId, admin) =>
        call(() => {
          const chat = this.adminChat(who().userId, id);
          const m = chat.members.find((x) => x.userId === userId);
          if (!m) throw new ServerError('not_found', 404);
          m.role = admin ? 'admin' : 'member';
          this.note(chat, who().userId, { event: admin ? 'admin' : 'not_admin', users: [userId] });
          return this.wireChat(chat);
        }),
      updateGroup: (id, changes) =>
        call(() => {
          const chat = this.adminChat(who().userId, id);
          if (changes.title !== undefined) chat.title = changes.title;
          if (changes.onlyAdminsSend !== undefined) chat.onlyAdminsSend = changes.onlyAdminsSend;
          this.note(chat, who().userId, { event: 'changed', ...changes });
          return this.wireChat(chat);
        }),
      lookup: (email) => call(() => [...this.users.values()].find((u) => u.email === email) ?? null),
      statusAudience: (ids) =>
        call(() => {
          const me = who().userId;
          let chat = [...this.chats.values()].find((c) => c.kind === 'status' && c.owner === me);
          if (!chat) {
            chat = { id: uuid(), kind: 'status', members: [], seq: 0, owner: me };
            this.chats.set(chat.id, chat);
          }
          const others = [...new Set(ids)].filter((u) => u !== me && this.users.has(u));
          chat.members = [{ userId: me, role: 'admin' as Role }, ...others.map((userId) => ({ userId, role: 'member' as Role }))];
          return this.wireChat(chat, me);
        }),
    };
  }

  connect: ConnectionFactory = ({ token, deviceUuid }): Connection => {
    let open = false;
    return {
      open: (h) => {
        open = true;
        void (async () => {
          await tick();
          const d = this.devices.find((x) => x.uuid === deviceUuid && x.token === token);
          if (!d || !open) return;
          this.online.set(d.uuid, h);
          h.status(true);
          // Like the real channel: everything waiting, oldest first (or jumbled, with chaos).
          const waiting = [...(this.pending.get(d.uuid) ?? [])];
          for (let i = 0; i < waiting.length; i += 200) this.deliverTo(d.uuid, waiting.slice(i, i + 200));
        })();
      },
      close: () => {
        open = false;
        if (this.online.has(deviceUuid)) {
          this.online.delete(deviceUuid);
        }
      },
      push: async (event, payload) => {
        await tick();
        const d = this.devices.find((x) => x.uuid === deviceUuid && x.token === token);
        if (!d || !this.online.has(deviceUuid)) throw new OfflineError('Not connected');
        return this.handle(d, event, payload);
      },
    };
  };

  /** Drops a device's connection, as a phone going into a tunnel would. */
  drop(userId: string, deviceId: number) {
    const d = this.devices.find((x) => x.userId === userId && x.deviceId === deviceId);
    const h = d && this.online.get(d.uuid);
    if (!d || !h) return;
    this.online.delete(d.uuid);
    h.status(false);
  }

  // ---- Inside the server ----

  private me(userId: string): Me {
    const u = this.users.get(userId)!;
    return { id: u.id, email: u.email, phone: u.phone ?? null, name: u.name, privacy: { lastSeen: 'everyone', online: 'everyone', readReceipts: true, photo: 'everyone' } };
  }

  private byToken(token: string) {
    const d = this.devices.find((x) => x.token === token);
    if (!d) throw new ServerError('unauthorized', 401);
    return d;
  }

  private addDevice(userId: string, deviceId: number, keys: DeviceKeys, pre: PreKeys) {
    const d: Device = { uuid: uuid(), userId, deviceId, token: uuid(), keys, ec: [...pre.preKeys], kyber: [...pre.kyberPreKeys] };
    this.devices.push(d);
    return d;
  }

  /** The pretend Google token is just "google:<name>". */
  private signIn(idToken: string, keys: DeviceKeys & { name: string }, pre: PreKeys): SignedIn {
    const name = idToken.replace(/^google:/, '');
    let user = [...this.users.values()].find((u) => u.name === name);
    if (!user) {
      user = { id: uuid(), name, email: `${name.toLowerCase()}@gmail.com` };
      this.users.set(user.id, user);
    }
    // Signing in again replaces every device, like the real server.
    for (const old of this.devicesOf(user.id)) {
      this.devices.splice(this.devices.indexOf(old), 1);
      this.pending.delete(old.uuid);
      this.online.delete(old.uuid);
    }
    const d = this.addDevice(user.id, 1, keys, pre);
    return { token: d.token, user: this.me(user.id), deviceId: 1, deviceUuid: d.uuid };
  }

  /** The pretend SMS code is always 123456. */
  private signInWithPhone(phone: string, code: string, keys: DeviceKeys & { name: string }, pre: PreKeys): SignedIn {
    if (code !== FAKE_CODE) throw new ServerError('wrong_code', 422);
    let user = [...this.users.values()].find((u) => u.phone === phone);
    const made = !user;
    if (!user) {
      user = { id: uuid(), name: `PakChat ${phone.slice(-4)}`, email: null, phone };
      this.users.set(user.id, user);
    }
    return { ...this.takeOver(user, keys, pre), ...(made ? { newAccount: true } : {}) };
  }

  private takeOver(user: User, keys: DeviceKeys & { name: string }, pre: PreKeys): SignedIn {
    for (const old of this.devicesOf(user.id)) {
      this.devices.splice(this.devices.indexOf(old), 1);
      this.pending.delete(old.uuid);
      this.online.delete(old.uuid);
    }
    const d = this.addDevice(user.id, 1, keys, pre);
    return { token: d.token, user: this.me(user.id), deviceId: 1, deviceUuid: d.uuid };
  }

  private devicesOf(userId: string) {
    return this.devices.filter((d) => d.userId === userId).sort((a, b) => a.deviceId - b.deviceId);
  }

  private bundles(userId: string, ids?: number[]): Bundle[] {
    return this.devicesOf(userId)
      .filter((d) => !ids || ids.includes(d.deviceId))
      .map((d) => {
        const ec = d.ec.shift() ?? null;
        const kyber = d.kyber.shift() ?? d.keys.kyberLastResort;
        return {
          registrationId: d.keys.registrationId,
          deviceId: d.deviceId,
          preKeyId: ec?.keyId ?? null,
          preKey: ec?.publicKey ?? null,
          signedPreKeyId: d.keys.signedPreKey.keyId,
          signedPreKey: d.keys.signedPreKey.publicKey,
          signedPreKeySignature: d.keys.signedPreKey.signature,
          identityKey: d.keys.identityKey,
          kyberPreKeyId: kyber.keyId,
          kyberPreKey: kyber.publicKey,
          kyberPreKeySignature: kyber.signature,
        };
      });
  }

  private isMember(chat: FakeChat, userId: string) {
    return chat.members.some((m) => m.userId === userId);
  }

  private memberChat(userId: string, id: string) {
    const chat = this.chats.get(id);
    if (!chat || !this.isMember(chat, userId)) throw new ServerError('not_found', 404);
    return chat;
  }

  private adminChat(userId: string, id: string) {
    const chat = this.memberChat(userId, id);
    if (chat.kind !== 'group' || chat.members.find((m) => m.userId === userId)?.role !== 'admin') throw new ServerError('forbidden', 403);
    return chat;
  }

  private wireChat(c: FakeChat, viewer?: string): ServerChat {
    // Someone's status: only its owner sees who else can see it.
    const visible = c.kind === 'status' && viewer !== c.owner ? c.members.filter((m) => m.userId === c.owner || m.userId === viewer) : c.members;
    const out: ServerChat = { id: c.id, kind: c.kind, seq: c.seq, members: visible.map((m) => ({ ...m })) };
    if (c.kind === 'group') {
      out.title = c.title;
      out.onlyAdminsSend = !!c.onlyAdminsSend;
      out.inviteCode = null;
    }
    return out;
  }

  private openDirect(me: string, them: string) {
    const found = [...this.chats.values()].find((c) => c.kind === 'direct' && this.isMember(c, me) && this.isMember(c, them) && c.members.length === (me === them ? 1 : 2));
    if (found) return found;
    const members = [...new Set([me, them])].map((userId) => ({ userId, role: 'member' as Role }));
    const chat: FakeChat = { id: uuid(), kind: 'direct', members, seq: 0 };
    this.chats.set(chat.id, chat);
    return chat;
  }

  private createGroup(me: string, title: string, ids: string[], onlyAdminsSend?: boolean) {
    const members = [{ userId: me, role: 'admin' as Role }, ...ids.filter((u) => u !== me).map((userId) => ({ userId, role: 'member' as Role }))];
    const chat: FakeChat = { id: uuid(), kind: 'group', members, seq: 0, title, onlyAdminsSend };
    this.chats.set(chat.id, chat);
    this.note(chat, me, { event: 'created', title, users: members.map((m) => m.userId) });
    return chat;
  }

  /** A group note ("Ali added Sara") for every member, plus `extra` people (someone just removed). */
  private note(chat: FakeChat, by: string, data: Record<string, unknown>, extra: string[] = []) {
    const seq = ++chat.seq;
    const users = [...new Set([...chat.members.map((m) => m.userId), ...extra])];
    const list = users.flatMap((u) => this.devicesOf(u));
    this.store(
      list.map((d) => [d.uuid, { id: 0, chat_id: chat.id, seq, from: by, from_device: null, kind: 'system', sent_at: new Date(this.clock()).toISOString(), data: { ...data, by } }]),
    );
  }

  private handle(d: Device, event: string, p: Record<string, unknown>): Record<string, unknown> {
    switch (event) {
      case 'send':
        return this.send(d, p);
      case 'call':
        return this.call(d, p);
      case 'ack': {
        const ids = new Set(p.ids as number[]);
        this.pending.set(d.uuid, (this.pending.get(d.uuid) ?? []).filter((e) => !ids.has(e.id)));
        return {};
      }
      case 'receipt':
        return this.receipt(d, p);
      case 'typing': {
        const chat = this.chats.get(p.chat_id as string);
        if (!chat || !this.isMember(chat, d.userId)) return {};
        for (const m of chat.members) {
          if (m.userId === d.userId) continue;
          for (const other of this.devicesOf(m.userId)) this.online.get(other.uuid)?.typing({ chat_id: chat.id, user_id: d.userId, typing: p.typing === true });
        }
        // The real server never answers "typing".
        throw new OfflineError('no reply');
      }
      case 'watch':
      case 'unwatch':
        return {};
      default:
        throw new ServerError('bad_request');
    }
  }

  private send(sender: Device, p: Record<string, unknown>) {
    const chat = this.chats.get(p.chat_id as string);
    if (!chat || !this.isMember(chat, sender.userId)) throw new ServerError('not_found');
    const kind = (p.kind as string) ?? 'message';
    const envelopes = (p.envelopes as Sealed[]) ?? [];
    const group = p.group as { type: number; body: string } | undefined;
    const known = p.devices as { user_id: string; device_id: number }[] | undefined;

    if (!['message', 'reaction', 'control'].includes(kind)) throw new ServerError('bad_request');
    if (kind === 'control' && (group || !envelopes.length)) throw new ServerError('bad_request');
    if (![...envelopes, ...(group ? [group] : [])].every((e) => [2, 3, 7, 8].includes(e.type))) throw new ServerError('bad_request');
    if (chat.onlyAdminsSend && kind === 'message' && chat.members.find((m) => m.userId === sender.userId)?.role !== 'admin') throw new ServerError('admins_only');
    if (chat.kind === 'direct' && group) throw new ServerError('bad_request');
    if (chat.kind !== 'direct' && !envelopes.length && !group) throw new ServerError('bad_request');
    // Someone else's status: likes and resends only, to its owner only.
    if (chat.kind === 'status' && sender.userId !== chat.owner) {
      if (!['reaction', 'control'].includes(kind) || group || envelopes.some((e) => e.user_id !== chat.owner)) throw new ServerError('forbidden', 403);
    }

    const recipients = chat.members.flatMap((m) => this.devicesOf(m.userId)).filter((d) => d.uuid !== sender.uuid);
    const k = (u: string, id: number) => `${u}:${id}`;
    const expected = new Set(recipients.map((d) => k(d.userId, d.deviceId)));
    const given = new Set(envelopes.map((e) => k(e.user_id, e.device_id)));
    const extra = new Set([...given].filter((x) => !expected.has(x)));
    let missing = new Set<string>();
    if (kind !== 'control') {
      if (chat.kind === 'direct') missing = new Set([...expected].filter((x) => !given.has(x)));
      else if (known) {
        const named = new Set(known.map((x) => k(x.user_id, x.device_id)));
        missing = new Set([...expected].filter((x) => !named.has(x)));
        for (const x of named) if (!expected.has(x)) extra.add(x);
      }
    }
    if (missing.size || extra.size) {
      const list = (set: Set<string>) =>
        [...set].map((x) => {
          const i = x.lastIndexOf(':');
          return { user_id: x.slice(0, i), device_id: Number(x.slice(i + 1)) };
        });
      throw new ServerError('stale_devices', 0, { reason: 'stale_devices', missing: list(missing), extra: list(extra) });
    }

    const seq = ++chat.seq;
    const sentAt = new Date(this.clock()).toISOString();
    const base = { chat_id: chat.id, seq, from: sender.userId, from_device: sender.deviceId, kind: kind as WireEnvelope['kind'], sent_at: sentAt };
    const byKey = new Map(recipients.map((d) => [k(d.userId, d.deviceId), d]));
    const rows: [string, WireEnvelope][] = envelopes.map((e) => [byKey.get(k(e.user_id, e.device_id))!.uuid, { ...base, id: 0, type: e.type, body: e.body }]);
    if (group) for (const d of recipients) rows.push([d.uuid, { ...base, id: 0, type: group.type, body: group.body }]);
    this.store(rows);
    return { seq, sent_at: sentAt };
  }

  /** A call message: no number, straight to the named devices that are in the chat. */
  private call(sender: Device, p: Record<string, unknown>) {
    const chat = this.chats.get(p.chat_id as string);
    if (!chat || !this.isMember(chat, sender.userId) || chat.kind === 'status') throw new ServerError('not_found');
    const envelopes = (p.envelopes as Sealed[]) ?? [];
    if (!envelopes.length || !envelopes.every((e) => e.type === 2 || e.type === 3)) throw new ServerError('bad_request');
    this.calls.push({ chatId: chat.id, from: sender.userId, ring: p.ring === true, to: envelopes.length });
    const recipients = chat.members.flatMap((m) => this.devicesOf(m.userId)).filter((d) => d.uuid !== sender.uuid);
    const base = { chat_id: chat.id, seq: null, from: sender.userId, from_device: sender.deviceId, kind: 'call' as const, sent_at: new Date(this.clock()).toISOString() };
    const rows: [string, WireEnvelope][] = [];
    for (const e of envelopes) {
      const d = recipients.find((x) => x.userId === e.user_id && x.deviceId === e.device_id);
      if (d) rows.push([d.uuid, { ...base, id: 0, type: e.type, body: e.body }]);
    }
    this.store(rows);
    return {};
  }

  private receipt(sender: Device, p: Record<string, unknown>) {
    const chat = this.chats.get(p.chat_id as string);
    const to = p.to as string;
    if (!chat || !this.isMember(chat, sender.userId) || !this.isMember(chat, to)) throw new ServerError('not_found');
    const status = p.status as string;
    const targets = chat.members
      .flatMap((m) => this.devicesOf(m.userId))
      .filter((d) => d.uuid !== sender.uuid && ((d.userId === to && to !== sender.userId) || (d.userId === sender.userId && status === 'read')));
    this.store(
      targets.map((d) => [
        d.uuid,
        { id: 0, chat_id: chat.id, seq: null, from: sender.userId, from_device: sender.deviceId, kind: 'receipt', sent_at: new Date(this.clock()).toISOString(), data: { status, seqs: p.seqs, to } },
      ]),
    );
    return {};
  }

  /** Saves envelopes for devices, then pushes them to the ones online. */
  private store(rows: [string, WireEnvelope][]) {
    const byDevice = new Map<string, WireEnvelope[]>();
    for (const [deviceUuid, e] of rows) {
      e.id = this.nextId++;
      if (e.body) this.seen.push(e);
      this.pending.set(deviceUuid, [...(this.pending.get(deviceUuid) ?? []), e]);
      byDevice.set(deviceUuid, [...(byDevice.get(deviceUuid) ?? []), e]);
    }
    for (const [deviceUuid, list] of byDevice) this.deliverTo(deviceUuid, list);
  }

  private deliverTo(deviceUuid: string, list: WireEnvelope[]) {
    const h = this.online.get(deviceUuid);
    if (!h || !list.length) return;
    let batch = list.map((e) => structuredClone(e));
    if (this.chaos.rewrite) batch = batch.map(this.chaos.rewrite);
    if (this.chaos.shuffle) batch = batch.sort(() => Math.random() - 0.5);
    if (this.chaos.reverse) batch = batch.reverse();
    if (this.chaos.duplicate) batch = [...batch, ...batch.map((e) => structuredClone(e))];
    setTimeout(() => {
      if (this.online.get(deviceUuid) === h) h.envelopes(batch);
    }, 0);
  }
}
