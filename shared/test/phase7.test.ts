// Phase 7 in the core: view once, live location, contact cards, planned calls,
// link cards, "reply privately", and "Undo" on a message just sent.

import { afterEach, describe, expect, test } from 'vitest';

import type { PakChat } from '../src/client';
import { parseContent } from '../src/content';
import { World } from './people';

let w: World;
afterEach(() => w?.stop());

const wrap = (x: Record<string, unknown>) => JSON.stringify({ v: 1, id: 'm1', chat: 'c1', at: 1, ...x });
const file = { id: 'f', key: 'k', digest: 'd', size: 10, mime: 'image/jpeg', kind: 'image' };

describe('what a message can carry', () => {
  test('view once (photos, videos and voice notes only) and round videos', () => {
    expect(parseContent(wrap({ t: 'file', file: { ...file, once: true } }))).toMatchObject({ file: { once: true } });
    const doc = parseContent(wrap({ t: 'file', file: { ...file, kind: 'doc', once: true } }));
    expect(doc?.t === 'file' && doc.file.once).toBeUndefined();
    const round = parseContent(wrap({ t: 'file', file: { ...file, kind: 'video', mime: 'video/mp4', round: true } }));
    expect(round?.t === 'file' && round.file.round).toBe(true);
    const photo = parseContent(wrap({ t: 'file', file: { ...file, round: true } }));
    expect(photo?.t === 'file' && photo.file.round).toBeUndefined();
  });

  test('places, contact cards and planned calls', () => {
    expect(parseContent(wrap({ t: 'location', lat: 24.86, lng: 67.0, name: 'Clifton', live: 5 }))).toMatchObject({ t: 'location', lat: 24.86, lng: 67.0, name: 'Clifton', live: 5 });
    expect(parseContent(wrap({ t: 'location', lat: 91, lng: 0 }))).toBeNull();
    expect(parseContent(wrap({ t: 'location', lat: '24', lng: 0 }))).toBeNull();
    expect(parseContent(wrap({ t: 'contact', cards: [{ name: 'Ammi', phones: ['+923001234567'], extra: 1 }] }))).toMatchObject({ cards: [{ name: 'Ammi', phones: ['+923001234567'] }] });
    expect(parseContent(wrap({ t: 'contact', cards: [] }))).toBeNull();
    expect(parseContent(wrap({ t: 'contact', cards: [{ name: '', phones: [] }] }))).toBeNull();
    expect(parseContent(wrap({ t: 'event', title: 'Revision', at: 99, video: true, link: 'abc_DEF-1' }))).toMatchObject({ t: 'event', title: 'Revision', at: 99, video: true, link: 'abc_DEF-1' });
    expect(parseContent(wrap({ t: 'event', title: 'x', at: 1, link: 'no spaces' }))).toBeNull();
  });

  test('link cards and private replies', () => {
    const link = { url: 'https://dawn.com/news/1', title: 'News', thumb: 'AAAA' };
    expect(parseContent(wrap({ t: 'text', text: 'see https://dawn.com/news/1', link }))).toMatchObject({ link });
    // A bad card is dropped, not the words.
    expect(parseContent(wrap({ t: 'text', text: 'hi', link: { url: 'javascript:alert(1)' } }))).not.toHaveProperty('link');
    const quote = { chat: 'g1', author: 'u1', id: 'm9', kind: 'text', text: 'Who has the notes?' };
    expect(parseContent(wrap({ t: 'text', text: 'I do', quote }))).toMatchObject({ quote });
    expect(parseContent(wrap({ t: 'text', text: 'I do', quote: { ...quote, kind: 'bomb' } }))).toBeNull();
  });
});

describe('in a chat', () => {
  async function two() {
    w = new World();
    const ali = await w.person('Ali');
    const sara = await w.person('Sara');
    const chat = await ali.client.openDirect(sara.id);
    return { ali, sara, chat };
  }

  test('view once: opened on one of my devices is gone on the others, and the sender sees it', async () => {
    const { ali, sara, chat } = await two();
    const web = await w.website(sara);
    const m = await sendFile(ali, chat.id, { once: true });
    await w.settle();
    const ref = { author: ali.id, id: m.id };
    expect((await sara.storage.getMessage(chat.id, ali.id, m.id))?.file?.once).toBe(true);

    await sara.client.opened(chat.id, ref);
    await w.settle();
    for (const p of [sara, web]) expect(await p.storage.getMessage(chat.id, ali.id, m.id)).toMatchObject({ opened: true });
    expect((await ali.storage.getMessage(chat.id, ali.id, m.id))?.openedBy).toEqual([sara.id]);

    // Not for ordinary photos, and the sender can't "open" their own.
    const plain = await sendFile(ali, chat.id, {});
    await w.settle();
    await expect(sara.client.opened(chat.id, { author: ali.id, id: plain.id })).rejects.toThrow("Can't opened that message");
    await expect(ali.client.opened(chat.id, ref)).rejects.toThrow("Can't opened that message");
  });

  test('live location moves, then stops; only its sender can move it', async () => {
    const { ali, sara, chat } = await two();
    const until = w.now() + 3600_000;
    const m = await ali.client.sendLocation(chat.id, { lat: 24.8, lng: 67.0, live: until });
    await w.settle();
    const ref = { author: ali.id, id: m.id };
    await ali.client.moveLive(chat.id, ref, 24.9, 67.1);
    await w.settle();
    expect((await sara.storage.getMessage(chat.id, ali.id, m.id))?.location).toMatchObject({ lat: 24.9, lng: 67.1, live: until });
    await expect(sara.client.moveLive(chat.id, ref, 0, 0)).rejects.toThrow("Can't live that message");
    await ali.client.moveLive(chat.id, ref, 24.95, 67.2, true);
    await w.settle();
    const stopped = await sara.storage.getMessage(chat.id, ali.id, m.id);
    expect(stopped?.location?.live).toBeLessThanOrEqual(w.now());
    expect(stopped?.location?.lat).toBe(24.95);
  });

  test('a live location can last 8 hours at most, whatever the sender says', async () => {
    const { ali, sara, chat } = await two();
    const m = await ali.client.sendLocation(chat.id, { lat: 1, lng: 2, live: w.now() + 30 * 86_400_000 });
    await w.settle();
    const got = await sara.storage.getMessage(chat.id, ali.id, m.id);
    expect(got!.location!.live! - got!.sentAt).toBeLessThanOrEqual(8 * 3600_000);
  });

  test('contact cards and planned calls arrive', async () => {
    const { ali, sara, chat } = await two();
    await ali.client.sendContacts(chat.id, [{ name: 'Ammi', phones: ['+923001234567'] }]);
    await ali.client.sendPlan(chat.id, { title: 'Revision', at: w.now() + 86_400_000, video: true });
    await w.settle();
    const [card, plan] = await sara.client.messages(chat.id);
    expect(card).toMatchObject({ kind: 'contact', contacts: [{ name: 'Ammi', phones: ['+923001234567'] }] });
    expect(plan).toMatchObject({ kind: 'event', plan: { title: 'Revision', video: true } });
  });

  test('an event: when it ends, where, and who is going', async () => {
    const { ali, sara, chat } = await two();
    const at = w.now() + 86_400_000;
    const m = await ali.client.sendPlan(chat.id, { title: 'Dinner', at, end: at + 7_200_000, place: 'Clifton', video: false, general: true });
    await w.settle();
    const [got] = await sara.client.messages(chat.id);
    expect(got).toMatchObject({ kind: 'event', plan: { title: 'Dinner', end: at + 7_200_000, place: 'Clifton', general: true } });
    expect(got.plan?.call).toBeUndefined();
    await sara.client.vote(chat.id, { author: ali.id, id: m.id }, [0]);
    await w.settle();
    const [mine] = await ali.client.messages(chat.id);
    expect(mine.votes).toEqual({ [sara.id]: [0] });
    expect(parseContent(wrap({ t: 'event', title: 'x', at: 10, end: 5, video: false }))).toBeNull();
  });

  test('Undo: a held message can be taken back before it goes, and nothing reaches them', async () => {
    const { ali, sara, chat } = await two();
    const m = await ali.client.sendText(chat.id, 'oops', { hold: 5_000 });
    await w.settle();
    expect(await w.texts(sara, chat.id)).toEqual([]);
    expect(await ali.client.takeBack(chat.id, { author: ali.id, id: m.id })).toBe(true);
    expect(await ali.client.messages(chat.id)).toEqual([]);
    expect(await ali.client.outbox()).toEqual([]);
  });

  test('Undo: once the wait is over it goes, and is too late to take back', async () => {
    const { ali, sara, chat } = await two();
    const m = await ali.client.sendText(chat.id, 'kept', { hold: 30 });
    await new Promise((r) => setTimeout(r, 80));
    await w.settle();
    expect(await w.texts(sara, chat.id)).toEqual(['Ali: kept']);
    expect(await ali.client.takeBack(chat.id, { author: ali.id, id: m.id })).toBe(false);
  });

  test('a held message holds up only its own chat', async () => {
    const { ali, sara, chat } = await two();
    const bilal = await w.person('Bilal');
    const other = await ali.client.openDirect(bilal.id);
    await ali.client.sendText(chat.id, 'held', { hold: 5_000 });
    await ali.client.sendText(chat.id, 'after it');
    await ali.client.sendText(other.id, 'elsewhere');
    await w.settle();
    expect(await w.texts(bilal, other.id)).toEqual(['Ali: elsewhere']);
    // In its own chat nothing overtakes it.
    expect(await w.texts(sara, chat.id)).toEqual([]);
  });

  test('reply privately carries a copy of the group message', async () => {
    const { ali, sara, chat } = await two();
    const quote = { chat: 'g1', author: sara.id, id: 'm9', kind: 'text' as const, text: 'Who has the notes?' };
    await ali.client.sendText(chat.id, 'I do', { quote });
    await w.settle();
    expect((await sara.client.messages(chat.id))[0]).toMatchObject({ text: 'I do', quote });
  });
});

let uploads = 0;
async function sendFile(p: { client: PakChat }, chatId: string, extra: { once?: true }) {
  (p.client as unknown as { o: { files: unknown } }).o.files = {
    upload: async () => ({ id: `file-${++uploads}`, key: 'k'.repeat(88), digest: 'd'.repeat(44) }),
  };
  return p.client.sendFile(chatId, { local: 'file:///x.jpg', size: 10, mime: 'image/jpeg', kind: 'image', ...extra });
}
