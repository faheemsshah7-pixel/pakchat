// The "listened" sign: when someone plays my voice note, its mic turns blue,
// like WhatsApp. Playing one on my phone marks it played on my website too.

import { afterEach, describe, expect, test } from 'vitest';

import type { PakChat } from '../src/client';
import { World } from './people';

let w: World;
afterEach(() => w?.stop());

let uploads = 0;
async function sendVoice(p: { client: PakChat }, chatId: string) {
  (p.client as unknown as { o: { files: unknown } }).o.files = {
    upload: async () => ({ id: `voice-${++uploads}`, key: 'k'.repeat(88), digest: 'd'.repeat(44) }),
  };
  return p.client.sendFile(chatId, { local: 'file:///v.m4a', size: 10, mime: 'audio/mp4', kind: 'voice', duration: 3000 });
}

describe('played voice notes', () => {
  test('Sara plays Ali\'s voice note: blue mic for Ali, and her website knows too', async () => {
    w = new World();
    const ali = await w.person('Ali');
    const sara = await w.person('Sara');
    const saraWeb = await w.website(sara);
    const chat = await ali.client.openDirect(sara.id);
    const sent = await sendVoice(ali, chat.id);
    await w.settle();
    const got = (await sara.storage.getMessage(chat.id, ali.id, sent.id))!;
    expect(got.played).toBeUndefined();

    await sara.client.markPlayed(got);
    await w.settle();
    const mine = (await ali.storage.getMessage(chat.id, ali.id, sent.id))!;
    expect(mine.played).toBe(true);
    expect(mine.status).toBe('read');
    expect((await sara.storage.getMessage(chat.id, ali.id, sent.id))!.played).toBe(true);
    expect((await saraWeb.storage.getMessage(chat.id, ali.id, sent.id))!.played).toBe(true);
  });

  test('only voice notes from others count, and only once', async () => {
    w = new World();
    const ali = await w.person('Ali');
    const sara = await w.person('Sara');
    const chat = await ali.client.openDirect(sara.id);
    const voice = await sendVoice(ali, chat.id);
    const text = await ali.client.sendText(chat.id, 'Hello');
    await w.settle();
    // My own voice note: nothing to send.
    await ali.client.markPlayed(voice);
    // A text isn't played.
    await sara.client.markPlayed(text);
    await w.settle();
    expect((await ali.storage.getMessage(chat.id, ali.id, voice.id))!.played).toBeUndefined();
    expect((await ali.storage.getMessage(chat.id, ali.id, text.id))!.played).toBeUndefined();
  });

  test('a group: the mic turns blue once everyone has played it', async () => {
    w = new World();
    const ali = await w.person('Ali');
    const sara = await w.person('Sara');
    const bilal = await w.person('Bilal');
    const group = await ali.client.createGroup('Study group', [sara.id, bilal.id]);
    await w.settle();
    const sent = await sendVoice(ali, group.id);
    await w.settle();

    await sara.client.markPlayed(sent);
    await w.settle();
    let mine = (await ali.storage.getMessage(group.id, ali.id, sent.id))!;
    expect(mine.playedBy).toEqual([sara.id]);
    expect(mine.readBy).toContain(sara.id);
    expect(mine.played).toBeUndefined();

    await bilal.client.markPlayed(sent);
    await w.settle();
    mine = (await ali.storage.getMessage(group.id, ali.id, sent.id))!;
    expect(mine.played).toBe(true);
    expect(mine.status).toBe('read');
  });

  test('the server cannot make up a "security code changed" note', async () => {
    w = new World();
    const ali = await w.person('Ali');
    const sara = await w.person('Sara');
    const group = await ali.client.createGroup('Study group', [sara.id]);
    await w.settle();
    const fake = w.server as unknown as { note: (c: unknown, by: string, d: Record<string, unknown>) => void; chats: Map<string, unknown> };
    fake.note(fake.chats.get(group.id), ali.id, { event: 'code_changed' });
    fake.note(fake.chats.get(group.id), ali.id, { event: 'added', users: [] });
    await w.settle();
    const notes = (await sara.storage.listMessages(group.id, { limit: 50 })).filter((m) => m.kind === 'system').map((m) => m.event?.event);
    expect(notes).not.toContain('code_changed');
    expect(notes).toContain('added');
  });
});
