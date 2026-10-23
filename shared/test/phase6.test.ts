// Phase 6 in the core: call messages (straight through, never saved), status
// (who sees it, likes to the owner only, a day long), and the new things a
// message can carry (voice note bars, GIFs, stickers, status replies).

import { afterEach, describe, expect, test } from 'vitest';

import type { CallEvent } from '../src/client';
import { STATUS_MS } from '../src/client';
import { parseContent } from '../src/content';
import { OfflineError } from '../src/server';
import { World } from './people';

let w: World;
afterEach(() => w?.stop());

const wrap = (x: Record<string, unknown>) => JSON.stringify({ v: 1, id: 'm1', chat: 'c1', at: 1, ...x });
const file = { id: 'f', key: 'k', digest: 'd', size: 10, mime: 'audio/mp4', kind: 'voice' };

describe('what a message can carry', () => {
  test('voice note bars, GIFs and stickers', () => {
    const voice = parseContent(wrap({ t: 'file', file: { ...file, duration: 4200, waveform: 'AAEC/w==' } }));
    expect(voice?.t === 'file' && voice.file.waveform).toBe('AAEC/w==');
    // Bars that aren't base64 are refused.
    expect(parseContent(wrap({ t: 'file', file: { ...file, waveform: '<script>' } }))).toBeNull();
    const gif = parseContent(wrap({ t: 'file', file: { ...file, kind: 'video', mime: 'video/mp4', gif: true } }));
    expect(gif?.t === 'file' && gif.file.gif).toBe(true);
    // Only `true` counts.
    const notGif = parseContent(wrap({ t: 'file', file: { ...file, kind: 'video', gif: 'yes' } }));
    expect(notGif?.t === 'file' && notGif.file.gif).toBeUndefined();
    expect(parseContent(wrap({ t: 'file', file: { ...file, kind: 'sticker', mime: 'image/webp' } }))?.t).toBe('file');
  });

  test('a status in words has one of the colours; a reply to a status carries a copy of it', () => {
    expect(parseContent(wrap({ t: 'text', text: 'Eid Mubarak', bg: 3 }))).toMatchObject({ bg: 3 });
    expect(parseContent(wrap({ t: 'text', text: 'x', bg: 99 }))).toBeNull();
    const reply = parseContent(wrap({ t: 'text', text: 'Nice!', status: { author: 'u1', id: 's1', kind: 'image', thumb: 'AAAA', extra: 1 } }));
    expect(reply).toMatchObject({ status: { author: 'u1', id: 's1', kind: 'image', thumb: 'AAAA' } });
    expect(reply?.t === 'text' && reply.status).not.toHaveProperty('extra');
    expect(parseContent(wrap({ t: 'text', text: 'x', status: { author: 'u1', id: 's1', kind: 'poll' } }))).toBeNull();
  });

  test('call messages are checked like everything else', () => {
    const offer = parseContent(wrap({ t: 'call', call: 'c9', op: 'offer', sdp: 'v=0', video: true }));
    expect(offer).toMatchObject({ t: 'call', call: 'c9', op: 'offer', sdp: 'v=0', video: true });
    const ice = parseContent(wrap({ t: 'call', call: 'c9', op: 'ice', cand: { candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0, junk: 1 } }));
    expect(ice).toMatchObject({ cand: { candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 } });
    expect(parseContent(wrap({ t: 'call', call: 'c9', op: 'explode' }))).toBeNull();
    expect(parseContent(wrap({ t: 'call', call: 'c9', op: 'offer', sdp: 'x'.repeat(20_001) }))).toBeNull();
    expect(parseContent(wrap({ t: 'call', call: 'c9', op: 'ice', cand: { candidate: 5 } }))).toBeNull();
  });
});

describe('call messages', () => {
  async function two() {
    w = new World();
    const ali = await w.person('Ali');
    const sara = await w.person('Sara');
    const chat = await ali.client.openDirect(sara.id);
    return { ali, sara, chat };
  }

  test('ring the other phone, straight through, and are never saved', async () => {
    const { ali, sara, chat } = await two();
    const got: CallEvent[] = [];
    sara.client.on('call', (e) => got.push(e));

    await ali.client.sendCall(chat.id, { call: 'call-1', op: 'ring', video: true }, { ring: true });
    await w.settle();

    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ chatId: chat.id, from: ali.id, fromDevice: 1, signal: { t: 'call', call: 'call-1', op: 'ring', video: true } });
    expect(w.server.calls).toEqual([{ chatId: chat.id, from: ali.id, ring: true, to: 1 }]);
    // Nothing in the chat, nothing unread, nothing waiting.
    expect(await sara.client.messages(chat.id)).toEqual([]);
    expect((await sara.storage.getChat(chat.id))?.unread ?? 0).toBe(0);
    expect(await ali.client.outbox()).toEqual([]);
  });

  test('can go to one device only (connecting), and work both ways', async () => {
    const { ali, sara, chat } = await two();
    const web = await w.website(sara);
    const phone: CallEvent[] = [];
    const site: CallEvent[] = [];
    const back: CallEvent[] = [];
    sara.client.on('call', (e) => phone.push(e));
    web.client.on('call', (e) => site.push(e));
    ali.client.on('call', (e) => back.push(e));

    await ali.client.sendCall(chat.id, { call: 'c', op: 'offer', sdp: 'v=0' }, { to: [sara.client.device] });
    await w.settle();
    expect(phone.map((e) => e.signal.op)).toEqual(['offer']);
    expect(site).toEqual([]);

    await sara.client.sendCall(chat.id, { call: 'c', op: 'answer', sdp: 'v=0' }, { to: [{ userId: ali.id, deviceId: 1 }] });
    await w.settle();
    expect(back.map((e) => [e.signal.op, e.from])).toEqual([['answer', sara.id]]);
  });

  test("can't be sent while offline", async () => {
    const { ali, chat } = await two();
    w.server.drop(ali.id, 1);
    await expect(ali.client.sendCall(chat.id, { call: 'c', op: 'ring' })).rejects.toBeInstanceOf(OfflineError);
  });

  test('a message pretending to be a call (or the other way round) is dropped', async () => {
    const { ali, sara, chat } = await two();
    const got: CallEvent[] = [];
    sara.client.on('call', (e) => got.push(e));
    // The server (up to no good) labels a call as a message, and a message as a call.
    w.server.chaos.rewrite = (e) => (e.kind === 'call' ? { ...e, kind: 'message', seq: 99 } : e.kind === 'message' ? { ...e, kind: 'call' } : e);
    await ali.client.sendCall(chat.id, { call: 'c', op: 'ring' }, { ring: true });
    await ali.client.sendText(chat.id, 'hello');
    await w.settle();
    expect(got).toEqual([]);
    expect(await sara.client.messages(chat.id)).toEqual([]);
  });

  test('ring a whole group', async () => {
    w = new World();
    const ali = await w.person('Ali');
    const sara = await w.person('Sara');
    const bilal = await w.person('Bilal');
    const group = await ali.client.createGroup('Study', [sara.id, bilal.id]);
    await w.settle();
    const rang: string[] = [];
    sara.client.on('call', (e) => rang.push(`sara:${e.signal.op}:${e.signal.group}`));
    bilal.client.on('call', (e) => rang.push(`bilal:${e.signal.op}:${e.signal.group}`));
    await ali.client.sendCall(group.id, { call: 'g', op: 'ring', group: true }, { ring: true });
    await w.settle();
    expect(rang.sort()).toEqual(['bilal:ring:true', 'sara:ring:true']);
  });
});

describe('status', () => {
  async function three() {
    w = new World();
    const ali = await w.person('Ali');
    const sara = await w.person('Sara');
    const bilal = await w.person('Bilal');
    const status = await ali.client.setStatusAudience([sara.id, bilal.id]);
    await sara.client.syncChats();
    await bilal.client.syncChats();
    return { ali, sara, bilal, status };
  }

  test('only its owner sees who can see it; the others see a chat with the owner', async () => {
    const { ali, sara, status } = await three();
    expect(status.kind).toBe('status');
    expect(status.members).toHaveLength(3);
    expect((await ali.client.myStatus())?.id).toBe(status.id);
    const theirs = await sara.storage.getChat(status.id);
    expect(theirs?.members.map((m) => m.userId).sort()).toEqual([ali.id, sara.id].sort());
    expect(await sara.client.myStatus()).toBeNull();
  });

  test('a status reaches everyone allowed, lasts a day, and only its owner can post', async () => {
    const { ali, sara, bilal, status } = await three();
    const sent = await ali.client.sendText(status.id, 'Eid Mubarak', { bg: 2 });
    await w.settle();

    for (const p of [sara, bilal]) {
      const [m] = await p.client.messages(status.id);
      expect(m).toMatchObject({ text: 'Eid Mubarak', bg: 2, author: ali.id });
      expect(m.expiresAt).toBe(m.sentAt + STATUS_MS);
    }
    const mine = await ali.storage.getMessage(status.id, ali.id, sent.id);
    expect(mine?.expiresAt).toBe(mine!.sentAt + STATUS_MS);

    // Sara can't post to Ali's status: the server refuses, so it shows as failed.
    await sara.client.sendText(status.id, 'Mine!');
    await w.settle();
    expect((await sara.client.messages(status.id)).find((m) => m.text === 'Mine!')?.status).toBe('failed');
    expect(await w.texts(bilal, status.id)).toEqual(['Ali: Eid Mubarak']);
  });

  test("a like goes to the owner alone; 'seen' shows who watched", async () => {
    const { ali, sara, bilal, status } = await three();
    const sent = await ali.client.sendText(status.id, 'Hello');
    await w.settle();
    const [got] = await sara.client.messages(status.id);

    await sara.client.react(status.id, { author: ali.id, id: got.id }, '❤️');
    await sara.client.markRead(status.id, got.seq!);
    await w.settle();

    const mine = await ali.storage.getMessage(status.id, ali.id, sent.id);
    expect(mine?.reactions).toEqual({ [sara.id]: '❤️' });
    expect(mine?.readBy).toEqual([sara.id]);
    // Bilal never hears about Sara's like.
    const [his] = await bilal.client.messages(status.id);
    expect(his.reactions).toBeUndefined();
  });

  test('someone taken out gets nothing new, and the key changes', async () => {
    const { ali, bilal, status } = await three();
    await ali.client.sendText(status.id, 'One');
    await w.settle();
    const before = await ali.storage.getValue<{ distributionId: string }>(`groupKey:${status.id}`);

    await ali.client.setStatusAudience([w.people[1].id]);
    await ali.client.sendText(status.id, 'Two');
    await w.settle();

    const after = await ali.storage.getValue<{ distributionId: string }>(`groupKey:${status.id}`);
    expect(after?.distributionId).not.toBe(before?.distributionId);
    expect(await w.texts(bilal, status.id)).toEqual(['Ali: One']);
    expect(await w.texts(w.people[1], status.id)).toEqual(['Ali: One', 'Ali: Two']);
  });

  test('a reply goes to the one-to-one chat, with a copy of the status', async () => {
    const { ali, sara } = await three();
    const chat = await sara.client.openDirect(ali.id);
    await sara.client.sendText(chat.id, 'So nice!', { status: { author: ali.id, id: 's1', kind: 'text', text: 'Eid Mubarak' } });
    await w.settle();
    const [m] = await ali.client.messages(chat.id);
    expect(m.statusReply).toEqual({ author: ali.id, id: 's1', kind: 'text', text: 'Eid Mubarak' });
  });

  test('no calls in a status', async () => {
    const { ali, status } = await three();
    await expect(ali.client.sendCall(status.id, { call: 'c', op: 'ring' })).rejects.toThrow('not_found');
  });
});

describe('notes in the chat from this phone', () => {
  test('a call note goes after the newest message, and later messages come under it', async () => {
    w = new World();
    const ali = await w.person('Ali');
    const sara = await w.person('Sara');
    const chat = await ali.client.openDirect(sara.id);
    await ali.client.sendText(chat.id, 'one');
    await w.settle();
    await ali.client.noteCall(chat.id, 'call-7', { by: sara.id, video: false, group: false, missed: true, seconds: 0 }, Date.now());
    await ali.client.sendText(chat.id, 'two');
    await w.settle();
    const list = await ali.client.messages(chat.id);
    expect(list.map((m) => m.text ?? m.event?.event)).toEqual(['one', 'call', 'two']);
    expect(list[1].event).toMatchObject({ event: 'call', by: sara.id, missed: true });
    // Only on this phone.
    expect((await sara.client.messages(chat.id)).map((m) => m.text)).toEqual(['one', 'two']);
  });
});

describe('the default message timer', () => {
  test('a new chat starts with it; a chat that already has messages keeps its own', async () => {
    w = new World();
    const ali = await w.person('Ali');
    const sara = await w.person('Sara');
    const bilal = await w.person('Bilal');
    const day = 24 * 3600;
    const chat = await ali.client.openDirect(sara.id, day);
    await w.settle();
    expect((await sara.storage.getChat(chat.id))!.timer).toBe(day);
    const m = await ali.client.sendText(chat.id, 'Gone tomorrow');
    await w.settle();
    const seen = (await sara.storage.getMessage(chat.id, ali.id, m.id))!;
    expect(seen.expiresAt! - seen.sentAt).toBe(day * 1000);

    // Bilal and Sara already talk, with no timer: opening it again changes nothing.
    const old = await bilal.client.openDirect(sara.id);
    await bilal.client.sendText(old.id, 'Salam');
    await w.settle();
    await sara.client.openDirect(bilal.id, day);
    await w.settle();
    expect((await bilal.storage.getChat(old.id))!.timer ?? 0).toBe(0);

    const g = await ali.client.createGroup('Family', [sara.id, bilal.id], { defaultTimer: 7 * day });
    await w.settle();
    expect((await bilal.storage.getChat(g.id))!.timer).toBe(7 * day);
  });
});
