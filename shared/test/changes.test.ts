// Edits, deletes, reactions, polls, pins and disappearing messages. They're
// all locked messages too, and every phone checks the rules for itself.

import { afterEach, describe, expect, test } from 'vitest';

import { World } from './people';
import type { Kind } from './signals';

const MINUTE = 60_000;

describe.each([['node'], ['wasm']] as [Kind][])('changes (%s)', (kind) => {
  let w: World;
  afterEach(() => w.stop());

  async function group() {
    w = new World();
    const ali = await w.person('Ali', kind);
    const sara = await w.person('Sara', kind);
    const bilal = await w.person('Bilal', kind);
    const g = await ali.client.createGroup('Friends', [sara.id, bilal.id]);
    await w.settle();
    return { ali, sara, bilal, g };
  }

  test('edit and delete my own message, everywhere', async () => {
    const { ali, sara, bilal, g } = await group();
    const m = await ali.client.sendText(g.id, 'Mete at 5');
    await w.settle();
    await ali.client.edit(g.id, m.id, 'Meet at 5');
    await w.settle();
    for (const p of [ali, sara, bilal]) expect(await w.texts(p, g.id)).toEqual(['Ali: Meet at 5 (edited)']);
    await ali.client.deleteForEveryone(g.id, { author: ali.id, id: m.id });
    await w.settle();
    for (const p of [ali, sara, bilal]) expect(await w.texts(p, g.id)).toEqual(['Ali: (deleted)']);
  });

  test('the time limits: edit for 15 minutes, delete for 60 hours', async () => {
    // Sara isn't an admin (admins may delete anything, any time).
    const { ali, sara, g } = await group();
    const m = await sara.client.sendText(g.id, 'First words');
    await w.settle();
    // 20 minutes later (by the server's clock), an edit from a tampered app is ignored.
    w.offset += 20 * MINUTE;
    const edit = JSON.stringify({ v: 1, id: crypto.randomUUID(), chat: g.id, at: w.now(), t: 'edit', target: m.id, text: 'Changed history' });
    await sendRaw(sara, g.id, edit);
    await w.settle();
    expect(await w.texts(ali, g.id)).toEqual(['Sara: First words']);
    // The app itself won't even try.
    await expect(sara.client.edit(g.id, m.id, 'Changed history')).rejects.toThrow("Can't edit that message");
    // Deleting works within 60 hours, but not after.
    const m2 = await sara.client.sendText(g.id, 'Second');
    await w.settle();
    await sara.client.deleteForEveryone(g.id, { author: sara.id, id: m2.id });
    await w.settle();
    expect(await w.texts(ali, g.id)).toEqual(['Sara: First words', 'Sara: (deleted)']);
    w.offset += 61 * 60 * MINUTE;
    await expect(sara.client.deleteForEveryone(g.id, { author: sara.id, id: m.id })).rejects.toThrow("Can't delete that message");
    await sendRaw(sara, g.id, JSON.stringify({ v: 1, id: crypto.randomUUID(), chat: g.id, at: w.now(), t: 'delete', target: { author: sara.id, id: m.id } }));
    await w.settle();
    expect(await w.texts(ali, g.id)).toEqual(['Sara: First words', 'Sara: (deleted)']);
  });

  test("nobody can edit or delete someone else's message, except a group admin deleting", async () => {
    const { ali, sara, bilal, g } = await group();
    const m = await sara.client.sendText(g.id, "Sara's words");
    await w.settle();
    // Bilal can't, even with a tampered app. (His reaction sends his group key first.)
    await bilal.client.react(g.id, { author: sara.id, id: m.id }, '😮');
    await w.settle();
    await expect(bilal.client.deleteForEveryone(g.id, { author: sara.id, id: m.id })).rejects.toThrow("Can't delete that message");
    await sendRaw(bilal, g.id, JSON.stringify({ v: 1, id: crypto.randomUUID(), chat: g.id, at: Date.now(), t: 'delete', target: { author: sara.id, id: m.id } }));
    // An edit only ever points at the sender's own messages, so this finds nothing.
    await sendRaw(bilal, g.id, JSON.stringify({ v: 1, id: crypto.randomUUID(), chat: g.id, at: Date.now(), t: 'edit', target: m.id, text: 'Bilal was here' }));
    await w.settle();
    expect(await w.texts(ali, g.id)).toEqual(["Sara: Sara's words"]);
    // Ali is the admin, so he can.
    await ali.client.deleteForEveryone(g.id, { author: sara.id, id: m.id });
    await w.settle();
    for (const p of [ali, sara, bilal]) expect(await w.texts(p, g.id)).toEqual(['Sara: (deleted)']);
  });

  test('reactions, votes and pins', async () => {
    const { ali, sara, bilal, g } = await group();
    const poll = await ali.client.sendPoll(g.id, 'Where to eat?', ['Biryani', 'Karahi', 'Pizza']);
    await w.settle();
    const ref = { author: ali.id, id: poll.id };
    await sara.client.vote(g.id, ref, [1]);
    await bilal.client.vote(g.id, ref, [0]);
    await sara.client.react(g.id, ref, '😋');
    await bilal.client.react(g.id, ref, '👍');
    await ali.client.pin(g.id, ref, Date.now() + 24 * 60 * MINUTE);
    await w.settle();
    // Bilal changes his mind, takes back his reaction, and tries to pick two (not allowed).
    await bilal.client.vote(g.id, ref, [1]);
    await bilal.client.react(g.id, ref, null);
    await w.settle();
    await expect(bilal.client.vote(g.id, ref, [0, 1])).rejects.toThrow("Can't vote that message");
    for (const p of [ali, sara, bilal]) {
      const m = (await p.storage.getMessage(g.id, ali.id, poll.id))!;
      expect(m.votes).toEqual({ [sara.id]: [1], [bilal.id]: [1] });
      expect(m.reactions).toEqual({ [sara.id]: '😋' });
      expect(m.pinnedUntil).toBeGreaterThan(Date.now());
    }
  });

  test('the author hears about a new reaction (for "Sara reacted"), once, and not about their own', async () => {
    const { ali, sara, bilal, g } = await group();
    const heard: string[] = [];
    ali.client.on('reacted', (e) => heard.push(`${e.from === sara.id ? 'Sara' : 'Bilal'} ${e.emoji}`));
    const m = await ali.client.sendText(g.id, 'Chai?');
    await w.settle();
    const ref = { author: ali.id, id: m.id };
    await sara.client.react(g.id, ref, '❤️');
    await sara.client.react(g.id, ref, '❤️');
    await bilal.client.react(g.id, ref, '👍');
    await bilal.client.react(g.id, ref, null);
    await ali.client.react(g.id, ref, '😂');
    await w.settle();
    expect(heard).toEqual(['Sara ❤️', 'Bilal 👍']);
  });

  test('changes that arrive before their message wait for it', async () => {
    const { ali, sara, bilal, g } = await group();
    sara.client.stop();
    const m = await ali.client.sendText(g.id, 'Helo');
    await w.settle();
    await ali.client.edit(g.id, m.id, 'Hello');
    await bilal.client.react(g.id, { author: ali.id, id: m.id }, '👋');
    await w.settle();
    // Everything comes to Sara back to front: the reaction and the edit first.
    w.server.chaos = { reverse: true };
    sara.client.start();
    await w.settle();
    expect(await w.texts(sara, g.id)).toEqual(['Ali: Hello (edited)']);
    expect((await sara.storage.getMessage(g.id, ali.id, m.id))!.reactions).toEqual({ [bilal.id]: '👋' });
  });

  test('disappearing messages', async () => {
    const { ali, sara, g } = await group();
    await sara.client.setTimer(g.id, 7 * 24 * 3600);
    await w.settle();
    expect((await ali.storage.getChat(g.id))!.timer).toBe(7 * 24 * 3600);
    const m = await ali.client.sendText(g.id, 'Gone in a week');
    await w.settle();
    const seen = (await sara.storage.getMessage(g.id, ali.id, m.id))!;
    expect(seen.expiresAt! - seen.sentAt).toBe(7 * 24 * 3600 * 1000);
  });

  test('keep in chat: a disappearing message stays for everyone, until whoever kept it lets go', async () => {
    const { ali, sara, bilal, g } = await group();
    await sara.client.setTimer(g.id, 24 * 3600);
    await w.settle();
    const m = await ali.client.sendText(g.id, 'The address is 12 Mall Road');
    await w.settle();
    const ref = { author: ali.id, id: m.id };
    await sara.client.keep(g.id, ref, true);
    await w.settle();
    for (const p of [ali, sara, bilal]) {
      const kept = (await p.storage.getMessage(g.id, ali.id, m.id))!;
      expect(kept.expiresAt).toBeUndefined();
      expect(kept.keptBy).toBe(sara.id);
    }
    // Bilal didn't keep it and didn't write it: he can't let it go.
    await expect(bilal.client.keep(g.id, ref, false)).rejects.toThrow();
    await w.settle();
    expect((await ali.storage.getMessage(g.id, ali.id, m.id))!.keptBy).toBe(sara.id);
    // Ali wrote it, so he can.
    await ali.client.keep(g.id, ref, false);
    await w.settle();
    for (const p of [ali, sara, bilal]) {
      const back = (await p.storage.getMessage(g.id, ali.id, m.id))!;
      expect(back.keptBy).toBeUndefined();
      expect(back.expiresAt! - back.sentAt).toBe(24 * 3600 * 1000);
    }
  });

  test('replies and mentions travel with the message', async () => {
    const { ali, sara, g } = await group();
    const q = await sara.client.sendText(g.id, 'Who has the notes?');
    await w.settle();
    await ali.client.sendText(g.id, '@Sara I do', { replyTo: { author: sara.id, id: q.id }, mentions: [sara.id] });
    await w.settle();
    const [, reply] = (await sara.client.messages(g.id)).filter((m) => m.kind === 'text');
    expect(reply.replyTo).toEqual({ author: sara.id, id: q.id });
    expect(reply.mentions).toEqual([sara.id]);
  });
});

/** Sends a hand-made message as a tampered app would, skipping the app's own checks. */
async function sendRaw(p: import('./people').Person, chatId: string, content: string) {
  const { distributionId } = (await p.storage.getValue<{ distributionId: string }>(`groupKey:${chatId}`)) ?? {};
  if (!distributionId) throw new Error(`${p.name} has no group key yet`);
  const body = await p.signal.groupEncrypt(p.client.me!.handle, distributionId, content);
  await (p.client as unknown as { push(e: string, x: object): Promise<unknown> }).push('send', { chat_id: chatId, kind: 'message', envelopes: [], group: { type: 7, body } });
}
