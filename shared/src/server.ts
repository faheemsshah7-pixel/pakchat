// Talking to the Phoenix server: its web addresses (this file) and the live
// connection (connection.ts). The server speaks snake_case JSON; the rest of
// the core uses camelCase, so the change happens here and nowhere else.
// See server/README.md for every address.

import type { Bundle, DeviceKeys, PreKeys } from './signal';
import type { Chat, Role } from './storage';

/** Me, as the server knows me. */
export type Me = {
  id: string;
  email: string;
  name: string;
  about?: string | null;
  photo?: string | null;
  privacy: { lastSeen: string; online: string; readReceipts: boolean };
};

export type SignedIn = {
  token: string;
  user: Me;
  /** 1 for the phone, 2 to 127 for linked devices. */
  deviceId: number;
  /** The device's own id, for the live connection. */
  deviceUuid: string;
};

/** A chat as the server sends it: who's in it, and its counter. */
export type ServerChat = Pick<Chat, 'id' | 'kind' | 'members' | 'title' | 'description' | 'photo' | 'onlyAdminsSend' | 'inviteCode'> & {
  seq: number;
};

/** What the server's web addresses can do, for the core. Tests use a pretend server with the same shape. */
export interface ServerApi {
  signIn(idToken: string, device: DeviceKeys & { name: string }, keys: PreKeys): Promise<SignedIn>;
  /** Every call after sign-in carries this session token. */
  useToken(token: string | null): void;
  signOut(): Promise<void>;
  keyCounts(): Promise<{ ec: number; kyber: number }>;
  uploadKeys(keys: PreKeys): Promise<void>;
  devices(userId: string): Promise<number[]>;
  /** Uses up one-time keys, so only ask for the devices you need. */
  bundles(userId: string, deviceIds?: number[]): Promise<Bundle[]>;
  chats(): Promise<ServerChat[]>;
  chat(id: string): Promise<ServerChat>;
  openDirect(userId: string): Promise<ServerChat>;
  createGroup(title: string, memberIds: string[], options?: { onlyAdminsSend?: boolean }): Promise<ServerChat>;
  addMembers(chatId: string, userIds: string[]): Promise<ServerChat>;
  /** Your own id means: leave. */
  removeMember(chatId: string, userId: string): Promise<void>;
  setAdmin(chatId: string, userId: string, admin: boolean): Promise<ServerChat>;
  updateGroup(chatId: string, changes: { title?: string; description?: string; onlyAdminsSend?: boolean }): Promise<ServerChat>;
  lookup(email: string): Promise<{ id: string; name: string } | null>;
}

/** The server said no. `reason` is its word for why, like "not_found". */
export class ServerError extends Error {
  constructor(
    readonly reason: string,
    readonly status = 0,
    readonly details: Record<string, unknown> = {},
  ) {
    super(`Server said: ${reason}`);
  }
}

/** The network is down, or the server didn't answer in time. Worth trying again later. */
export class OfflineError extends Error {}

// The server's shapes, as they come over the wire.
type WireChat = {
  id: string;
  kind: 'direct' | 'group';
  seq: number;
  members: { user_id: string; role: Role }[];
  title?: string;
  description?: string | null;
  photo?: string | null;
  only_admins_send?: boolean;
  invite_code?: string | null;
};

type WireMe = { id: string; email: string; name: string; about?: string | null; photo?: string | null; privacy: { last_seen: string; online: string; read_receipts: boolean } };

type WireBundle = {
  device_id: number;
  registration_id: number;
  identity_key: string;
  signed_pre_key_id: number;
  signed_pre_key: string;
  signed_pre_key_signature: string;
  pre_key_id: number | null;
  pre_key: string | null;
  kyber_pre_key_id: number;
  kyber_pre_key: string;
  kyber_pre_key_signature: string;
};

export function chatFromWire(c: WireChat): ServerChat {
  const chat: ServerChat = { id: c.id, kind: c.kind, seq: c.seq, members: c.members.map((m) => ({ userId: m.user_id, role: m.role })) };
  if (c.kind === 'group') {
    chat.title = c.title ?? '';
    if (c.description) chat.description = c.description;
    if (c.photo) chat.photo = c.photo;
    chat.onlyAdminsSend = c.only_admins_send === true;
    chat.inviteCode = c.invite_code ?? null;
  }
  return chat;
}

export function meFromWire(u: WireMe): Me {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    about: u.about,
    photo: u.photo,
    privacy: { lastSeen: u.privacy.last_seen, online: u.privacy.online, readReceipts: u.privacy.read_receipts },
  };
}

export function bundleFromWire(b: WireBundle): Bundle {
  return {
    registrationId: b.registration_id,
    deviceId: b.device_id,
    preKeyId: b.pre_key_id ?? null,
    preKey: b.pre_key ?? null,
    signedPreKeyId: b.signed_pre_key_id,
    signedPreKey: b.signed_pre_key,
    signedPreKeySignature: b.signed_pre_key_signature,
    identityKey: b.identity_key,
    kyberPreKeyId: b.kyber_pre_key_id,
    kyberPreKey: b.kyber_pre_key,
    kyberPreKeySignature: b.kyber_pre_key_signature,
  };
}

/** Keys in the server's shape, for sign-in and uploads. */
export function keysToWire(keys: PreKeys) {
  return {
    pre_keys: keys.preKeys.map((k) => ({ key_id: k.keyId, public_key: k.publicKey })),
    kyber_pre_keys: keys.kyberPreKeys.map((k) => ({ key_id: k.keyId, public_key: k.publicKey, signature: k.signature })),
  };
}

export function deviceToWire(d: DeviceKeys & { name: string }) {
  const signed = (k: DeviceKeys['signedPreKey']) => ({ key_id: k.keyId, public_key: k.publicKey, signature: k.signature });
  return {
    name: d.name,
    registration_id: d.registrationId,
    identity_key: d.identityKey,
    signed_pre_key: signed(d.signedPreKey),
    kyber_last_resort: signed(d.kyberLastResort),
  };
}

/** The real server, over the web. `baseUrl` is like "https://…" or "http://localhost:4000". */
export class HttpServer implements ServerApi {
  private token: string | null = null;

  constructor(
    private baseUrl: string,
    private timeoutMs = 15_000,
  ) {}

  useToken(token: string | null) {
    this.token = token;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new OfflineError(`Couldn't reach the server (${method} ${path})`);
    }
    if (res.status === 204) return undefined as T;
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const reason = typeof json.error === 'string' ? json.error : typeof json.reason === 'string' ? json.reason : `http_${res.status}`;
      throw new ServerError(reason, res.status, json);
    }
    return json as T;
  }

  async signIn(idToken: string, device: DeviceKeys & { name: string }, keys: PreKeys): Promise<SignedIn> {
    const r = await this.call<{ token: string; user: WireMe; device_id: number; device_uuid: string }>('POST', '/auth/google', {
      id_token: idToken,
      device: deviceToWire(device),
      ...keysToWire(keys),
    });
    return { token: r.token, user: meFromWire(r.user), deviceId: r.device_id, deviceUuid: r.device_uuid };
  }

  async signOut() {
    await this.call('DELETE', '/auth/session');
  }

  keyCounts() {
    return this.call<{ ec: number; kyber: number }>('GET', '/keys');
  }

  async uploadKeys(keys: PreKeys) {
    await this.call('POST', '/keys', keysToWire(keys));
  }

  async devices(userId: string) {
    return (await this.call<{ devices: number[] }>('GET', `/users/${encodeURIComponent(userId)}/devices`)).devices;
  }

  async bundles(userId: string, deviceIds?: number[]) {
    const r = await this.call<{ bundles: WireBundle[] }>('POST', `/users/${encodeURIComponent(userId)}/bundles`, deviceIds ? { device_ids: deviceIds } : {});
    return r.bundles.map(bundleFromWire);
  }

  async chats() {
    return (await this.call<{ chats: WireChat[] }>('GET', '/chats')).chats.map(chatFromWire);
  }

  async chat(id: string) {
    return chatFromWire(await this.call<WireChat>('GET', `/chats/${encodeURIComponent(id)}`));
  }

  async openDirect(userId: string) {
    return chatFromWire(await this.call<WireChat>('POST', '/chats/direct', { user_id: userId }));
  }

  async createGroup(title: string, memberIds: string[], options: { onlyAdminsSend?: boolean } = {}) {
    const body: Record<string, unknown> = { title, member_ids: memberIds };
    if (options.onlyAdminsSend) body.only_admins_send = true;
    return chatFromWire(await this.call<WireChat>('POST', '/groups', body));
  }

  async addMembers(chatId: string, userIds: string[]) {
    return chatFromWire(await this.call<WireChat>('POST', `/groups/${encodeURIComponent(chatId)}/members`, { user_ids: userIds }));
  }

  async removeMember(chatId: string, userId: string) {
    await this.call('DELETE', `/groups/${encodeURIComponent(chatId)}/members/${encodeURIComponent(userId)}`);
  }

  async setAdmin(chatId: string, userId: string, admin: boolean) {
    return chatFromWire(await this.call<WireChat>(admin ? 'PUT' : 'DELETE', `/groups/${encodeURIComponent(chatId)}/admins/${encodeURIComponent(userId)}`));
  }

  async updateGroup(chatId: string, changes: { title?: string; description?: string; onlyAdminsSend?: boolean }) {
    const body: Record<string, unknown> = {};
    if (changes.title !== undefined) body.title = changes.title;
    if (changes.description !== undefined) body.description = changes.description;
    if (changes.onlyAdminsSend !== undefined) body.only_admins_send = changes.onlyAdminsSend;
    return chatFromWire(await this.call<WireChat>('PATCH', `/groups/${encodeURIComponent(chatId)}`, body));
  }

  async lookup(email: string) {
    try {
      return await this.call<{ id: string; name: string }>('GET', `/users/lookup?email=${encodeURIComponent(email)}`);
    } catch (err) {
      if (err instanceof ServerError && err.status === 404) return null;
      throw err;
    }
  }
}
