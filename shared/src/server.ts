// Talking to the Phoenix server: its web addresses (this file) and the live
// connection (connection.ts). The server speaks snake_case JSON; the rest of
// the core uses camelCase, so the change happens here and nowhere else.
// See server/README.md for every address.

import type { Bundle, DeviceKeys, PreKeys } from './signal';
import type { Chat, Role } from './storage';

/** Me, as the server knows me. */
export type Me = {
  id: string;
  /** Null when I signed in by phone and haven't added a Gmail. */
  email: string | null;
  /** Like "+923001234567". Null until I add one. */
  phone?: string | null;
  name: string;
  about?: string | null;
  photo?: string | null;
  privacy: { lastSeen: string; online: string; readReceipts: boolean; photo: string; about: string; groups: string };
};

export type SignedIn = {
  token: string;
  user: Me;
  /** 1 for the phone, 2 to 127 for linked devices. */
  deviceId: number;
  /** The device's own id, for the live connection. */
  deviceUuid: string;
  /** The account was made just now (signing in by phone): ask for a name. */
  newAccount?: boolean;
};

/** Someone found by a hashed number or Gmail from my phone's contacts. */
export type Match = { hash: string; user: { id: string; name: string; about?: string | null; photo?: string | null } };

/** A chat as the server sends it: who's in it, and its counter. */
export type ServerChat = Pick<
  Chat,
  'id' | 'kind' | 'members' | 'title' | 'description' | 'photo' | 'onlyAdminsSend' | 'inviteCode' | 'inviteExpiresAt' | 'inviteMaxUses' | 'inviteUses' | 'communityId' | 'announcements' | 'callLink' | 'groupsByMembers' | 'joinApproval' | 'membersEdit' | 'membersAdd' | 'createdBy'
> & {
  seq: number;
};

/** What the server's web addresses can do, for the core. Tests use a pretend server with the same shape. */
export interface ServerApi {
  signIn(idToken: string, device: DeviceKeys & { name: string }, keys: PreKeys): Promise<SignedIn>;
  signInWithPhone(phone: string, code: string, device: DeviceKeys & { name: string }, keys: PreKeys): Promise<SignedIn>;
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
  updateGroup(chatId: string, changes: GroupChanges): Promise<ServerChat>;
  lookup(email: string): Promise<{ id: string; name: string } | null>;
  /** Sets who sees my status; answers my status chat. */
  statusAudience(userIds: string[]): Promise<ServerChat>;
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

/** A GIF from KLIPY (through our server): a small video, and a still-ish preview for the picker. */
export type Gif = { id: string; mp4: string; preview: string; width: number; height: number };

// The server's shapes, as they come over the wire.
type WireChat = {
  id: string;
  kind: 'direct' | 'group' | 'status' | 'community';
  seq: number;
  members: { user_id: string; role: Role }[];
  title?: string;
  description?: string | null;
  photo?: string | null;
  only_admins_send?: boolean;
  invite_code?: string | null;
  invite_expires_at?: string | null;
  invite_max_uses?: number | null;
  invite_uses?: number | null;
  community_id?: string | null;
  announcements?: boolean;
  call_link?: boolean;
  groups_by_members?: boolean;
  join_approval?: boolean;
  members_edit?: boolean;
  members_add?: boolean;
  created_by?: string | null;
};

/** What a group's (or a community's) admins can change. */
export type GroupChanges = { title?: string; description?: string; photo?: string; onlyAdminsSend?: boolean; groupsByMembers?: boolean; joinApproval?: boolean; membersEdit?: boolean; membersAdd?: boolean };

/** An invite link, as the "Join group?" screen shows it. */
export type InviteInfo = {
  chatId: string;
  title: string;
  photo?: string | null;
  description?: string | null;
  members: number;
  kind: 'group' | 'community';
  callLink: boolean;
  /** Its admins approve who joins: joining sends them a request. */
  approval: boolean;
};

/** A group in a community's list. */
export type CommunityGroup = {
  id: string;
  title: string;
  description?: string | null;
  photo?: string | null;
  announcements: boolean;
  members: number;
  joined: boolean;
  /** Its admins approve who joins, and whether I've asked. */
  approval?: boolean;
  requested?: boolean;
};

/** A group someone suggested for a community, waiting for its admins: one of theirs, or a new one (`isNew`). */
export type GroupSuggestion = { id: string; title: string; photo?: string | null; members: number; isNew: boolean; suggestedBy: string; at: number };

/** Joining a group whose admins approve who joins: they've been asked. */
export const REQUESTED = 'requested' as const;

export type ReportReason = 'spam' | 'abuse' | 'scam' | 'other';

type WireMe = { id: string; email: string | null; phone?: string | null; name: string; about?: string | null; photo?: string | null; privacy: { last_seen: string; online: string; read_receipts: boolean; photo?: string; about?: string; groups?: string } };

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

type WireSignedIn = { token: string; user: WireMe; device_id: number; device_uuid: string; new_account?: boolean };

function signedIn(r: WireSignedIn): SignedIn {
  const out: SignedIn = { token: r.token, user: meFromWire(r.user), deviceId: r.device_id, deviceUuid: r.device_uuid };
  if (r.new_account) out.newAccount = true;
  return out;
}

export function chatFromWire(c: WireChat): ServerChat {
  const chat: ServerChat = { id: c.id, kind: c.kind, seq: c.seq, members: c.members.map((m) => ({ userId: m.user_id, role: m.role })) };
  if (c.kind === 'group' || c.kind === 'community') {
    chat.title = c.title ?? '';
    if (c.description) chat.description = c.description;
    // '' when it has none, so a removed photo goes on the phone too.
    chat.photo = c.photo ?? '';
    chat.onlyAdminsSend = c.only_admins_send === true;
    chat.inviteCode = c.invite_code ?? null;
    chat.inviteExpiresAt = c.invite_expires_at ? Date.parse(c.invite_expires_at) : null;
    chat.inviteMaxUses = c.invite_max_uses ?? null;
    chat.inviteUses = c.invite_uses ?? 0;
    chat.communityId = c.community_id ?? null;
    chat.announcements = c.announcements === true;
    chat.callLink = c.call_link === true;
    chat.groupsByMembers = c.groups_by_members === true;
    chat.joinApproval = c.join_approval === true;
    chat.membersEdit = c.members_edit === true;
    chat.membersAdd = c.members_add === true;
    if (c.created_by) chat.createdBy = c.created_by;
  }
  return chat;
}

function joined(r: WireChat | { requested: true }): ServerChat | typeof REQUESTED {
  return 'requested' in r ? REQUESTED : chatFromWire(r);
}

export function meFromWire(u: WireMe): Me {
  return {
    id: u.id,
    email: u.email ?? null,
    phone: u.phone ?? null,
    name: u.name,
    about: u.about,
    photo: u.photo,
    privacy: { lastSeen: u.privacy.last_seen, online: u.privacy.online, readReceipts: u.privacy.read_receipts, photo: u.privacy.photo ?? 'everyone', about: u.privacy.about ?? 'everyone', groups: u.privacy.groups ?? 'everyone' },
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
    return signedIn(
      await this.call<WireSignedIn>('POST', '/auth/google', {
        id_token: idToken,
        device: deviceToWire(device),
        ...keysToWire(keys),
      }),
    );
  }

  // ---- Phone numbers ----

  /** Sends a sign-in code to a number (typed any way). Answers the tidied number. */
  async sendSignInCode(phone: string) {
    const r = await this.call<{ phone: string; resend_after: number }>('POST', '/auth/phone/code', { phone });
    return { phone: r.phone, resendAfter: r.resend_after };
  }

  async signInWithPhone(phone: string, code: string, device: DeviceKeys & { name: string }, keys: PreKeys): Promise<SignedIn> {
    return signedIn(await this.call<WireSignedIn>('POST', '/auth/phone', { phone, code, device: deviceToWire(device), ...keysToWire(keys) }));
  }

  /** Emulator tests only: the last code the Mac's server printed for a number. */
  async testCode(phone: string) {
    return (await this.call<{ code: string }>('GET', `/auth/test/code?phone=${encodeURIComponent(phone)}`)).code;
  }

  /** Adds a Gmail to my account. Google's token proves it's mine. */
  async linkGoogle(idToken: string) {
    return meFromWire(await this.call<WireMe>('PUT', '/me/google', { id_token: idToken }));
  }

  /** Sends a code to a number I want to add to my account. */
  async sendLinkCode(phone: string) {
    const r = await this.call<{ phone: string; resend_after: number }>('POST', '/me/phone/code', { phone });
    return { phone: r.phone, resendAfter: r.resend_after };
  }

  async linkPhone(phone: string, code: string) {
    return meFromWire(await this.call<WireMe>('PUT', '/me/phone', { phone, code }));
  }

  /** Takes the Gmail or the number off my account (the other must stay). */
  async unlink(what: 'google' | 'phone') {
    return meFromWire(await this.call<WireMe>('DELETE', `/me/${what}`));
  }

  /** Which of these hashes (see contacts.ts) are people on PakChat. */
  async matchContacts(phones: string[], emails: string[]): Promise<Match[]> {
    return this.call<Match[]>('POST', '/contacts/match', { phones, emails });
  }

  // ---- Files and backups ----

  async fileLimits() {
    const r = await this.call<{ max_bytes: number; max_backup_bytes: number }>('GET', '/files/limits');
    return { maxBytes: r.max_bytes, maxBackupBytes: r.max_backup_bytes };
  }

  /** Makes room for a locked file of `size` bytes in a chat. The upload link starts with /api. */
  async startUpload(chatId: string, size: number) {
    const r = await this.call<{ id: string; upload_url: string }>('POST', '/files', { chat_id: chatId, size });
    return { id: r.id, uploadUrl: this.url(r.upload_url) };
  }

  /** Makes room for my profile photo, or (`chatId`) a group's or community's. The upload link starts with /api. */
  async startPhoto(size: number, chatId?: string) {
    const r = await this.call<{ id: string; upload_url: string }>('POST', '/photos', chatId ? { size, chat_id: chatId } : { size });
    return { id: r.id, uploadUrl: this.url(r.upload_url) };
  }

  /** A download link for a file, good for a few hours. */
  async fileLink(id: string) {
    return this.url((await this.call<{ url: string }>('GET', `/files/${encodeURIComponent(id)}/link`)).url);
  }

  /** My backup on the server, or null. */
  async backup() {
    try {
      const r = await this.call<{ id: string; size: number; made_at: string; url: string }>('GET', '/backup');
      return { id: r.id, size: r.size, madeAt: Date.parse(r.made_at), url: this.url(r.url) };
    } catch (err) {
      if (err instanceof ServerError && err.status === 404) return null;
      throw err;
    }
  }

  async startBackup(size: number) {
    const r = await this.call<{ id: string; upload_url: string }>('POST', '/backup', { size });
    return { id: r.id, uploadUrl: this.url(r.upload_url) };
  }

  async deleteBackup() {
    await this.call('DELETE', '/backup');
  }

  // ---- Calls, status and GIFs ----

  /** Where calls find a way through (STUN), and our relay (TURN) if there is one, as WebRTC takes them. */
  async iceServers(): Promise<{ urls: string[]; username?: string; credential?: string }[]> {
    return (await this.call<{ ice_servers: { urls: string[]; username?: string; credential?: string }[] }>('GET', '/calls/ice')).ice_servers;
  }

  async statusAudience(userIds: string[]) {
    return chatFromWire(await this.call<WireChat>('PUT', '/status/audience', { user_ids: userIds }));
  }

  /** Popular GIFs, or a search. Null when the server has no GIF key (the GIF tab hides). */
  async gifs(q: string, pos?: string, lang = 'en'): Promise<{ gifs: Gif[]; next: string | null } | null> {
    const query = new URLSearchParams({ lang });
    if (q.trim()) query.set('q', q.trim());
    if (pos) query.set('pos', pos);
    try {
      return await this.call<{ gifs: Gif[]; next: string | null }>('GET', `/gifs?${query}`);
    } catch (err) {
      if (err instanceof ServerError && err.status === 404) return null;
      throw err;
    }
  }

  /** The server's links are paths ("/api/files/…"); this makes them whole addresses. */
  private url(path: string) {
    return /^https?:/.test(path) ? path : `${this.baseUrl}${path}`;
  }

  /**
   * Emulator tests only: signs in a pretend `…@test.pakchat` account. Works only
   * when the server on the Mac was started with PAKCHAT_TEST_SIGN_IN=1.
   */
  async signInForTest(email: string, name: string, device: DeviceKeys & { name: string }, keys: PreKeys): Promise<SignedIn> {
    return signedIn(
      await this.call<WireSignedIn>('POST', '/auth/test', {
        email,
        name,
        device: deviceToWire(device),
        ...keysToWire(keys),
      }),
    );
  }

  /** Is pretend sign-in switched on (so the app shows it)? */
  async testSignInOn(): Promise<boolean> {
    try {
      return (await this.call<{ on?: boolean }>('GET', '/auth/test')).on === true;
    } catch {
      return false;
    }
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

  async updateGroup(chatId: string, changes: GroupChanges) {
    const body: Record<string, unknown> = {};
    if (changes.title !== undefined) body.title = changes.title;
    if (changes.description !== undefined) body.description = changes.description;
    if (changes.photo !== undefined) body.photo = changes.photo;
    if (changes.onlyAdminsSend !== undefined) body.only_admins_send = changes.onlyAdminsSend;
    if (changes.groupsByMembers !== undefined) body.groups_by_members = changes.groupsByMembers;
    if (changes.joinApproval !== undefined) body.join_approval = changes.joinApproval;
    if (changes.membersEdit !== undefined) body.members_edit = changes.membersEdit;
    if (changes.membersAdd !== undefined) body.members_add = changes.membersAdd;
    return chatFromWire(await this.call<WireChat>('PATCH', `/groups/${encodeURIComponent(chatId)}`, body));
  }

  // ---- Invite links, communities, call links and reports (phase 7) ----

  /** A new invite link (the old one stops). It can stop after `expiresIn` seconds, or once `maxUses` people join. */
  async resetInvite(chatId: string, limits: { expiresIn?: number; maxUses?: number } = {}) {
    const body: Record<string, unknown> = {};
    if (limits.expiresIn) body.expires_in = limits.expiresIn;
    if (limits.maxUses) body.max_uses = limits.maxUses;
    const r = await this.call<{ code: string; expires_at: string | null; max_uses: number | null }>('POST', `/groups/${encodeURIComponent(chatId)}/invite`, body);
    return { code: r.code, expiresAt: r.expires_at ? Date.parse(r.expires_at) : null, maxUses: r.max_uses ?? null };
  }

  async removeInvite(chatId: string) {
    await this.call('DELETE', `/groups/${encodeURIComponent(chatId)}/invite`);
  }

  async inviteInfo(code: string): Promise<InviteInfo> {
    const r = await this.call<{ chat_id: string; title: string; photo?: string | null; description?: string | null; members: number; kind?: string; call_link?: boolean; approval?: boolean }>(
      'GET',
      `/invites/${encodeURIComponent(code)}`,
    );
    return {
      chatId: r.chat_id,
      title: r.title,
      photo: r.photo,
      description: r.description,
      members: r.members,
      kind: r.kind === 'community' ? 'community' : 'group',
      callLink: r.call_link === true,
      approval: r.approval === true,
    };
  }

  /** The group, or REQUESTED when its admins approve who joins. */
  async joinInvite(code: string) {
    return joined(await this.call<WireChat | { requested: true }>('POST', `/invites/${encodeURIComponent(code)}/join`));
  }

  async createCommunity(title: string, description: string, groupIds: string[]) {
    const body: Record<string, unknown> = { title, group_ids: groupIds };
    if (description.trim()) body.description = description;
    return chatFromWire(await this.call<WireChat>('POST', '/communities', body));
  }

  async communityGroups(id: string): Promise<{ community: ServerChat; groups: CommunityGroup[] }> {
    const r = await this.call<{ community: WireChat; groups: CommunityGroup[] }>('GET', `/communities/${encodeURIComponent(id)}/groups`);
    return { community: chatFromWire(r.community), groups: r.groups };
  }

  /** Links my groups into a community, or makes a new group in it (`newGroup`). Answers the new group's id. */
  async addCommunityGroups(id: string, groupIds: string[], newGroup?: { title: string; description?: string }) {
    const body: Record<string, unknown> = { group_ids: groupIds };
    if (newGroup) Object.assign(body, newGroup);
    return (await this.call<{ group_id: string | null }>('POST', `/communities/${encodeURIComponent(id)}/groups`, body)).group_id;
  }

  async removeCommunityGroup(id: string, groupId: string) {
    await this.call('DELETE', `/communities/${encodeURIComponent(id)}/groups/${encodeURIComponent(groupId)}`);
  }

  /** The group, or REQUESTED when its admins approve who joins. */
  async joinCommunityGroup(id: string, groupId: string) {
    return joined(await this.call<WireChat | { requested: true }>('POST', `/communities/${encodeURIComponent(id)}/groups/${encodeURIComponent(groupId)}/join`));
  }

  /** Deactivates a community (its owner only): its groups go on, on their own. */
  async deactivateCommunity(id: string) {
    await this.call('DELETE', `/communities/${encodeURIComponent(id)}`);
  }

  /** Suggests groups of mine for a community, and/or a new group by a name. */
  async suggestGroups(id: string, groupIds: string[], title?: string) {
    const body: Record<string, unknown> = { group_ids: groupIds };
    if (title?.trim()) body.title = title.trim();
    await this.call('POST', `/communities/${encodeURIComponent(id)}/suggestions`, body);
  }

  /** Groups waiting for a community's admins (all of them for its admins, my own for anyone else). */
  async groupSuggestions(id: string): Promise<GroupSuggestion[]> {
    const r = await this.call<{ suggestions: { id: string; title: string; photo?: string | null; members: number; new: boolean; suggested_by: string; at: string }[] }>(
      'GET',
      `/communities/${encodeURIComponent(id)}/suggestions`,
    );
    return r.suggestions.map((s) => ({ id: s.id, title: s.title, photo: s.photo, members: s.members, isNew: s.new, suggestedBy: s.suggested_by, at: Date.parse(s.at) }));
  }

  /** Approves a suggested group (`yes`), or says no to it (or takes mine back). */
  async answerSuggestion(id: string, suggestionId: string, yes: boolean) {
    await this.call(yes ? 'POST' : 'DELETE', `/communities/${encodeURIComponent(id)}/suggestions/${encodeURIComponent(suggestionId)}`);
  }

  /** Who is asking to join a group (its admins only), oldest first. */
  async joinRequests(groupId: string): Promise<{ userId: string; at: number }[]> {
    const r = await this.call<{ requests: { user_id: string; at: string }[] }>('GET', `/groups/${encodeURIComponent(groupId)}/requests`);
    return r.requests.map((q) => ({ userId: q.user_id, at: Date.parse(q.at) }));
  }

  /** Lets someone in (`yes`) or says no; with my own id and no, takes my request back. */
  async answerJoinRequest(groupId: string, userId: string, yes: boolean) {
    await this.call(yes ? 'POST' : 'DELETE', `/groups/${encodeURIComponent(groupId)}/requests/${encodeURIComponent(userId)}`);
  }

  async createCallLink(title: string) {
    return chatFromWire(await this.call<WireChat>('POST', '/calls/links', { title }));
  }

  /** Reports a chat (and someone in it), with up to 5 recent messages from this phone. */
  async report(chatId: string, reason: ReportReason, userId: string | null, messages: { author: string; text: string; at: number }[]) {
    const body: Record<string, unknown> = { chat_id: chatId, reason, messages: messages.slice(-5) };
    if (userId) body.user_id = userId;
    await this.call('POST', '/reports', body);
  }

  /** Finds someone by Gmail, or by phone number with `{ phone }`. */
  async lookup(email: string, by: 'email' | 'phone' = 'email') {
    try {
      return await this.call<{ id: string; name: string }>('GET', `/users/lookup?${by}=${encodeURIComponent(email)}`);
    } catch (err) {
      if (err instanceof ServerError && err.status === 404) return null;
      throw err;
    }
  }
}
