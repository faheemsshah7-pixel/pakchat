// Groups: sender keys, people joining and leaving, and "only admins can send".

import { afterEach, describe, expect, test } from 'vitest';

import { SEALED, SignalError } from '../src/signal';
import { World } from './people';
import type { Kind } from './signals';

const WAYS: [string, Kind, Kind][] = [
  ['node', 'node', 'node'],
  ['wasm', 'wasm', 'wasm'],
  ['mixed', 'node', 'wasm'],
];

describe.each(WAYS)('groups (%s)', (_label, a, b) => {
  let w: World;
  afterEach(() => w.stop());

  async function study() {
    w = new World();
    const ali = await w.person('Ali', a);
    const sara = await w.person('Sara', b);
    const bilal = await w.person('Bilal', a);
    const group = await ali.client.createGroup('Study group', [sara.id, bilal.id]);
    await w.settle();
    return { ali, sara, bilal, group };
  }

  test('one lock per message, copied to everyone, and everyone reads it', async () => {
    const { ali, sara, bilal, group } = await study();
    await ali.client.sendText(group.id, 'Exam on Monday, revise chapter 3');
    await w.settle();
    await bilal.client.sendText(group.id, 'Shall we meet in the library?');
    await w.settle();
    const expected = ['Ali: Exam on Monday, revise chapter 3', 'Bilal: Shall we meet in the library?'];
    for (const p of [ali, sara, bilal]) expect(await w.texts(p, group.id)).toEqual(expected);
    // The group message itself was locked once: every copy is the same.
    const copies = w.server.seen.filter((e) => e.chat_id === group.id && e.type === SEALED.group && e.from === ali.id);
    expect(copies).toHaveLength(2);
    expect(copies[0].body).toBe(copies[1].body);
    // Ticks: delivered when both have it, read when both read it.
    const [first] = await ali.client.messages(group.id).then((l) => l.filter((m) => m.author === ali.id && m.kind === 'text'));
    expect(first.status).toBe('delivered');
    await sara.client.markRead(group.id);
    await w.settle();
    expect((await ali.storage.getMessage(group.id, ali.id, first.id))!.status).toBe('delivered');
    await bilal.client.markRead(group.id);
    await w.settle();
    expect((await ali.storage.getMessage(group.id, ali.id, first.id))!.status).toBe('read');
  });

  test('someone added later reads new messages, not old ones', async () => {
    const { ali, sara, group } = await study();
    await ali.client.sendText(group.id, 'Before Zara');
    await w.settle();
    const zara = await w.person('Zara', b);
    await ali.client.addMembers(group.id, [zara.id]);
    await w.settle();
    await ali.client.sendText(group.id, 'Welcome Zara');
    await sara.client.sendText(group.id, 'Hi Zara!');
    await w.settle();
    expect(await w.texts(zara, group.id)).toEqual(['Ali: Welcome Zara', 'Sara: Hi Zara!']);
    await zara.client.sendText(group.id, 'Thanks!');
    await w.settle();
    expect((await w.texts(ali, group.id)).at(-1)).toBe('Zara: Thanks!');
  });

  test('someone who leaves gets nothing more, and everyone changes their group key', async () => {
    const { ali, sara, bilal, group } = await study();
    await ali.client.sendText(group.id, 'Hello all');
    await w.settle();
    await sara.client.sendText(group.id, 'Hi');
    await w.settle();
    const before = await sara.storage.getValue<{ distributionId: string }>(`groupKey:${group.id}`);
    await bilal.client.removeMember(group.id, bilal.id);
    await w.settle();
    expect((await bilal.storage.getChat(group.id))!.left).toBe(true);
    await sara.client.sendText(group.id, 'Bilal has gone');
    await w.settle();
    const after = await sara.storage.getValue<{ distributionId: string }>(`groupKey:${group.id}`);
    expect(after!.distributionId).not.toBe(before!.distributionId);
    expect(await w.texts(ali, group.id)).toEqual(['Ali: Hello all', 'Sara: Hi', 'Sara: Bilal has gone']);
    expect(await w.texts(bilal, group.id)).toEqual(['Ali: Hello all', 'Sara: Hi']);
    // Even if a server handed Bilal the new message, he couldn't open it.
    const leaked = w.server.seen.filter((e) => e.chat_id === group.id && e.type === SEALED.group && e.from === sara.id).at(-1)!;
    await expect(bilal.signal.groupDecrypt(bilal.client.me!.handle, sara.id, 1, leaked.body!)).rejects.toMatchObject({ code: SignalError.noGroupKey });
    // And he can't send to it any more.
    await expect(bilal.client.sendText(group.id, 'Wait')).rejects.toThrow('Server said: not_found');
  });

  test('removed by an admin: same thing', async () => {
    const { ali, sara, bilal, group } = await study();
    await sara.client.sendText(group.id, 'One');
    await w.settle();
    await ali.client.removeMember(group.id, bilal.id);
    await w.settle();
    await sara.client.sendText(group.id, 'Two');
    await w.settle();
    expect(await w.texts(bilal, group.id)).toEqual(['Sara: One']);
    expect(await w.texts(ali, group.id)).toEqual(['Sara: One', 'Sara: Two']);
    const notes = (await bilal.client.messages(group.id)).filter((m) => m.kind === 'system').map((m) => m.event!.event);
    expect(notes).toEqual(['created', 'removed']);
  });

  test("a member's new website gets group messages", async () => {
    const { ali, sara, group } = await study();
    await ali.client.sendText(group.id, 'Before');
    await w.settle();
    const web = await w.website(sara, b);
    // Ali's list of the group's devices is out of date: the server tells him.
    await ali.client.sendText(group.id, 'After');
    await w.settle();
    expect(await w.texts(web, group.id)).toEqual(['Ali: After']);
    await web.client.sendText(group.id, 'From the website');
    await w.settle();
    for (const p of [ali, sara]) expect((await w.texts(p, group.id)).at(-1)).toBe('Sara: From the website');
  });

  test('offline in a group: catches up, in order, even when it arrives jumbled', async () => {
    const { ali, sara, bilal, group } = await study();
    sara.client.stop();
    await ali.client.sendText(group.id, 'Library at 4pm then');
    await bilal.client.sendText(group.id, 'Done, see you there');
    await ali.client.sendText(group.id, 'Bring chapter 3');
    await w.settle();
    // The group keys and the messages come back to front.
    w.server.chaos = { reverse: true };
    sara.client.start();
    await w.settle();
    expect(await w.texts(sara, group.id)).toEqual(['Ali: Library at 4pm then', 'Bilal: Done, see you there', 'Ali: Bring chapter 3']);
  });

  test('a reinstalled member asks for what they missed, and gets it', async () => {
    const { ali, sara, group } = await study();
    await ali.client.sendText(group.id, 'Hello');
    await w.settle();
    sara.client.stop();
    const fresh = await w.person('Sara', b);
    // Ali thinks Sara's device already has his group key. It doesn't any more.
    await ali.client.sendText(group.id, 'Are you there?');
    await w.settle();
    expect(await w.texts(fresh, group.id)).toEqual(['Ali: Are you there?']);
    await ali.client.sendText(group.id, 'Good');
    await w.settle();
    expect(await w.texts(fresh, group.id)).toEqual(['Ali: Are you there?', 'Ali: Good']);
  });

  test('only admins can send, but everyone can react and vote', async () => {
    w = new World();
    const ali = await w.person('Ali', a);
    const sara = await w.person('Sara', b);
    const news = await ali.client.createGroup('News', [sara.id], { onlyAdminsSend: true });
    await w.settle();
    const poll = await ali.client.sendPoll(news.id, 'Picnic on Sunday?', ['Yes', 'No']);
    await w.settle();
    const failed = await sara.client.sendText(news.id, 'Can I post?');
    await w.settle();
    expect((await sara.storage.getMessage(news.id, sara.id, failed.id))!.status).toBe('failed');
    expect(await w.texts(ali, news.id)).toEqual(['Ali: poll Picnic on Sunday?']);

    await sara.client.react(news.id, { author: ali.id, id: poll.id }, '👍');
    await sara.client.vote(news.id, { author: ali.id, id: poll.id }, [0]);
    await w.settle();
    const seen = (await ali.storage.getMessage(news.id, ali.id, poll.id))!;
    expect(seen.reactions).toEqual({ [sara.id]: '👍' });
    expect(seen.votes).toEqual({ [sara.id]: [0] });
  });

  test("words dressed up as a reaction in an admins-only group are ignored", async () => {
    w = new World();
    const ali = await w.person('Ali', a);
    const sara = await w.person('Sara', b);
    const news = await ali.client.createGroup('News', [sara.id], { onlyAdminsSend: true });
    await w.settle();
    const post = await ali.client.sendText(news.id, 'Welcome');
    await w.settle();
    // A real reaction first, so Sara's group key reaches Ali.
    await sara.client.react(news.id, { author: ali.id, id: post.id }, '❤️');
    await w.settle();
    // Now a tampered app sends real words with kind "reaction". The server
    // can't tell; Ali's app must.
    const { distributionId } = (await sara.storage.getValue<{ distributionId: string }>(`groupKey:${news.id}`))!;
    const text = JSON.stringify({ v: 1, id: crypto.randomUUID(), chat: news.id, at: Date.now(), t: 'text', text: 'Sneaky post' });
    const body = await sara.signal.groupEncrypt(sara.client.me!.handle, distributionId, text);
    const conn = w.server.connect({ token: sara.client.me!.token, deviceUuid: sara.client.me!.deviceUuid });
    conn.open({ envelopes: () => {}, typing: () => {}, presence: () => {}, status: () => {} });
    await w.settle();
    await conn.push('send', { chat_id: news.id, kind: 'reaction', envelopes: [], group: { type: 7, body } });
    await w.settle();
    expect(await w.texts(ali, news.id)).toEqual(['Ali: Welcome']);
    conn.close();
  });
});
