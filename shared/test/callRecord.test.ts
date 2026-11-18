// Calls in the chat, like WhatsApp's call bubbles: whoever started a call sends
// its record when it ends, and every phone and website in the chat shows it in
// place of its own note of the call, moved up the list, and missed ones unread.

import { afterEach, describe, expect, test } from 'vitest';

import { parseContent, writeContent, type Content } from '../src/content';
import { World } from './people';

let w: World;
afterEach(() => w?.stop());

describe('call records', () => {
  test('the record checks its shape', () => {
    const ok = { t: 'callRecord', v: 1, id: 'call-x1', chat: 'c1', at: 1, call: 'x1', video: true, seconds: 75 } as Content;
    expect(parseContent(writeContent(ok))).toMatchObject({ t: 'callRecord', call: 'x1', video: true, seconds: 75 });
    expect(parseContent(writeContent({ ...ok, seconds: -1 } as Content))).toBeNull();
    expect(parseContent(writeContent({ ...ok, video: 'yes' } as unknown as Content))).toBeNull();
    const group = parseContent(writeContent({ ...ok, group: true, joined: ['u1', 'u1', 'u2'] } as Content));
    expect(group).toMatchObject({ group: true, joined: ['u1', 'u2'] });
  });

  test('Ali calls Sara, nobody answers: one bubble each (on her website too), hers missed and unread', async () => {
    w = new World();
    const ali = await w.person('Ali');
    const sara = await w.person('Sara');
    const saraWeb = await w.website(sara);
    const chat = await ali.client.openDirect(sara.id);
    await ali.client.sendText(chat.id, 'hi');
    await w.settle();
    await sara.client.markRead(chat.id);
    await w.settle();
    const at = Date.now() - 30_000;
    // Each phone notes the call for itself, then Ali's record comes.
    await ali.client.noteCall(chat.id, 'k1', { by: ali.id, video: false, group: false, missed: false, seconds: 0 }, at);
    await sara.client.noteCall(chat.id, 'k1', { by: ali.id, video: false, group: false, missed: true, seconds: 0 }, at);
    await ali.client.sendCallRecord(chat.id, 'k1', { video: false, group: false, seconds: 0 }, at);
    await w.settle();

    for (const p of [ali, sara, saraWeb]) {
      const calls = (await p.client.messages(chat.id)).filter((m) => m.event?.event === 'call');
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ id: 'call-k1', author: ali.id, kind: 'system', sentAt: at });
      expect(calls[0].seq).not.toBeNull();
    }
    const hers = (await sara.storage.getMessage(chat.id, ali.id, 'call-k1'))!;
    expect(hers.event).toMatchObject({ missed: true, seconds: 0 });
    expect((await ali.storage.getMessage(chat.id, ali.id, 'call-k1'))!.event).toMatchObject({ missed: false });
    expect((await sara.storage.getChat(chat.id))!.unread).toBe(1);
    // Opening the chat reads it.
    await sara.client.markRead(chat.id);
    expect((await sara.storage.getChat(chat.id))!.unread).toBe(0);
  });

  test('an answered call is not unread, and moves the chat up', async () => {
    w = new World();
    const ali = await w.person('Ali');
    const sara = await w.person('Sara');
    const bilal = await w.person('Bilal');
    const chat = await ali.client.openDirect(sara.id);
    const other = await sara.client.openDirect(bilal.id);
    await ali.client.sendText(chat.id, 'hi');
    await w.settle();
    await sara.client.markRead(chat.id);
    await bilal.client.sendText(other.id, 'later one');
    await w.settle();
    const before = (await sara.storage.getChat(chat.id))!.lastActivity;
    expect(before).toBeLessThan((await sara.storage.getChat(other.id))!.lastActivity);
    await ali.client.noteCall(chat.id, 'k2', { by: ali.id, video: true, group: false, missed: false, seconds: 95 }, Date.now());
    await ali.client.sendCallRecord(chat.id, 'k2', { video: true, group: false, seconds: 95 }, Date.now());
    await w.settle();
    const c = (await sara.storage.getChat(chat.id))!;
    expect(c.unread).toBe(0);
    expect(c.lastActivity).toBeGreaterThan((await sara.storage.getChat(other.id))!.lastActivity);
    expect((await sara.storage.getMessage(chat.id, ali.id, 'call-k2'))!.event).toMatchObject({ video: true, missed: false, seconds: 95 });
  });

  test('a note made after the record came does not replace it', async () => {
    w = new World();
    const ali = await w.person('Ali');
    const sara = await w.person('Sara');
    const chat = await ali.client.openDirect(sara.id);
    await ali.client.sendText(chat.id, 'hi');
    await w.settle();
    await ali.client.noteCall(chat.id, 'k3', { by: ali.id, video: false, group: false, missed: false, seconds: 0 }, Date.now());
    await ali.client.sendCallRecord(chat.id, 'k3', { video: false, group: false, seconds: 0 }, Date.now());
    await w.settle();
    await sara.client.noteCall(chat.id, 'k3', { by: ali.id, video: false, group: false, missed: true, seconds: 0 }, Date.now());
    expect((await sara.storage.getMessage(chat.id, ali.id, 'call-k3'))!.seq).not.toBeNull();
  });

  test('a group call: who took part sees it answered, the others missed', async () => {
    w = new World();
    const ali = await w.person('Ali');
    const sara = await w.person('Sara');
    const bilal = await w.person('Bilal');
    const g = await ali.client.createGroup('Trip', [sara.id, bilal.id]);
    await ali.client.sendText(g.id, 'call?');
    await w.settle();
    await ali.client.noteCall(g.id, 'k4', { by: ali.id, video: false, group: true, missed: false, seconds: 60 }, Date.now());
    await ali.client.sendCallRecord(g.id, 'k4', { video: false, group: true, seconds: 60, joined: [sara.id] }, Date.now());
    await w.settle();
    expect((await sara.storage.getMessage(g.id, ali.id, 'call-k4'))!.event).toMatchObject({ missed: false });
    expect((await bilal.storage.getMessage(g.id, ali.id, 'call-k4'))!.event).toMatchObject({ missed: true });
  });

  test('a group call: who joined after the caller left keeps their own note', async () => {
    w = new World();
    const ali = await w.person('Ali');
    const sara = await w.person('Sara');
    const usman = await w.person('Usman');
    const g = await ali.client.createGroup('Trip', [sara.id, usman.id]);
    await ali.client.sendText(g.id, 'call?');
    await w.settle();
    await usman.client.noteCall(g.id, 'k5', { by: ali.id, video: false, group: true, missed: false, seconds: 600 }, Date.now());
    await ali.client.noteCall(g.id, 'k5', { by: ali.id, video: false, group: true, missed: false, seconds: 120 }, Date.now());
    await ali.client.sendCallRecord(g.id, 'k5', { video: false, group: true, seconds: 120, joined: [sara.id] }, Date.now());
    await w.settle();
    const m = await usman.storage.getMessage(g.id, ali.id, 'call-k5');
    expect(m!.seq).not.toBeNull();
    expect(m!.event).toMatchObject({ missed: false, seconds: 600 });
    expect((await usman.storage.getChat(g.id))!.unread).toBe(1);
  });
});
