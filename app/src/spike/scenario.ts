// The phase 1 test: three phones, 1-to-1 chats, a group, and one phone going
// offline and catching up. It runs on the phone (with the Kotlin module) and on
// a computer (spike-check, with Signal's Node library), and must pass on both.

import { Phone } from './phone';
import { Relay } from './relay';
import type { SignalApi } from './types';

export type Step = { title: string; ok: boolean; detail: string; ms: number };

// A fixed id for the test group. Real groups get a random one from the server.
const GROUP = '6f1c2a3b-4d5e-4f60-8a71-92b3c4d5e6f7';
const MEMBERS = ['Ali', 'Sara', 'Bilal'];

function check(ok: boolean, message: string) {
  if (!ok) throw new Error(message);
}

/** The texts a phone has read, oldest first, as "from: text" (with "(group)" for group ones). */
function texts(phone: Phone, after = 0) {
  return phone.inbox.slice(after).map((m) => `${m.from}${m.groupId ? ' (group)' : ''}: ${m.text}`);
}

function same(a: string[], b: string[]) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

async function rejects(p: Promise<unknown>) {
  try {
    await p;
    return { rejected: false, code: undefined as string | undefined };
  } catch (err) {
    return { rejected: true, code: (err as { code?: string }).code };
  }
}

/** Runs every step and reports each one. `onStep` lets the screen show them as they finish. */
export async function runScenario(api: SignalApi, onStep: (step: Step) => void = () => {}): Promise<Step[]> {
  const relay = new Relay();
  const [ali, sara, bilal] = MEMBERS.map((n) => new Phone(api, relay, n));
  const all = [ali, sara, bilal];
  const settle = () => Promise.all(all.map((p) => p.idle()));
  const sentTexts: string[] = [];
  const steps: Step[] = [];

  async function step(title: string, run: () => Promise<string>) {
    const start = Date.now();
    let result: Step;
    try {
      const detail = await run();
      result = { title, ok: true, detail, ms: Date.now() - start };
    } catch (err) {
      result = { title, ok: false, detail: (err as Error).message, ms: Date.now() - start };
    }
    steps.push(result);
    onStep(result);
  }

  async function say(from: Phone, to: Phone, text: string) {
    sentTexts.push(text);
    await from.sendText(to.name, text);
  }

  async function sayInGroup(from: Phone, text: string) {
    sentTexts.push(text);
    await from.sendGroup(GROUP, MEMBERS, text);
  }

  await step('Three phones make their keys', async () => {
    for (const p of all) await p.setup();
    for (const p of all) p.connect();
    return 'Ali, Sara and Bilal each have their own identity key and put 5 one-time key bundles on the server.';
  });

  await step('Ali and Sara chat 1-to-1', async () => {
    await say(ali, sara, 'Assalam o Alaikum, Sara!');
    await settle();
    await say(sara, ali, 'Walaikum Assalam, Ali!');
    await settle();
    check(same(texts(sara), ['Ali: Assalam o Alaikum, Sara!']), `Sara read: ${texts(sara).join(' | ')}`);
    check(same(texts(ali), ['Sara: Walaikum Assalam, Ali!']), `Ali read: ${texts(ali).join(' | ')}`);
    return 'Each message was locked on one phone and opened on the other.';
  });

  await step('The study group works', async () => {
    await sayInGroup(ali, 'Exam on Monday, revise chapter 3');
    await settle();
    await sayInGroup(bilal, 'Shall we meet in the library?');
    await settle();
    check(
      same(texts(sara, 1), ['Ali (group): Exam on Monday, revise chapter 3', 'Bilal (group): Shall we meet in the library?']),
      `Sara read: ${texts(sara, 1).join(' | ')}`,
    );
    check(same(texts(bilal), ['Ali (group): Exam on Monday, revise chapter 3']), `Bilal read: ${texts(bilal).join(' | ')}`);
    check(same(texts(ali, 1), ['Bilal (group): Shall we meet in the library?']), `Ali read: ${texts(ali, 1).join(' | ')}`);
    return 'Each group message was locked once with a sender key and copied by the server to the others.';
  });

  const saraBefore = sara.inbox.length;
  const whileAway = [
    'Ali: Are you there?',
    'Ali: Call me when you see this',
    'Bilal: Sara, can I borrow your notes?',
    'Ali (group): Library at 4pm then',
    'Bilal (group): Done, see you there',
  ];

  await step('Sara goes offline and others keep sending', async () => {
    sara.disconnect();
    await say(ali, sara, 'Are you there?');
    await say(ali, sara, 'Call me when you see this');
    // Bilal has never messaged Sara 1-to-1: he starts a new session while she's away.
    await say(bilal, sara, 'Sara, can I borrow your notes?');
    await settle();
    await sayInGroup(ali, 'Library at 4pm then');
    await settle();
    await sayInGroup(bilal, 'Done, see you there');
    await settle();
    check(sara.inbox.length === saraBefore, 'Sara got messages while offline');
    check(relay.pendingFor('Sara', 1) === 5, `Server holds ${relay.pendingFor('Sara', 1)} for Sara, expected 5`);
    check(same(texts(ali, 1), ['Bilal (group): Shall we meet in the library?', 'Bilal (group): Done, see you there']), `Ali read: ${texts(ali, 1).join(' | ')}`);
    return 'The server is holding 5 locked envelopes for Sara.';
  });

  await step('Sara reconnects and catches up', async () => {
    sara.connect();
    await settle();
    check(sara.errors.length === 0, sara.errors.join('; '));
    check(same(texts(sara, saraBefore), whileAway), `Sara read: ${texts(sara, saraBefore).join(' | ')}`);
    check(relay.pendingFor('Sara', 1) === 0, `Server still holds ${relay.pendingFor('Sara', 1)} for Sara`);
    return 'All 5 opened in order, and the server deleted each one once Sara confirmed it.';
  });

  await step('Sara replies after catching up', async () => {
    const aliBefore = ali.inbox.length;
    const bilalBefore = bilal.inbox.length;
    await sayInGroup(sara, 'Sorry, my internet was off!');
    await say(sara, bilal, 'Yes, take them');
    await settle();
    check(same(texts(ali, aliBefore), ['Sara (group): Sorry, my internet was off!']), `Ali read: ${texts(ali, aliBefore).join(' | ')}`);
    check(
      same(texts(bilal, bilalBefore), ['Sara (group): Sorry, my internet was off!', 'Sara: Yes, take them']),
      `Bilal read: ${texts(bilal, bilalBefore).join(' | ')}`,
    );
    return 'Her group and 1-to-1 replies opened on the other phones.';
  });

  await step('The server never saw the words', async () => {
    check(relay.seen.length > 0, 'Nothing went through the server');
    for (const e of relay.seen) {
      const raw = atob(e.sealed.body);
      for (const t of sentTexts) check(!raw.includes(t), `"${t}" was readable on the server`);
    }
    return `Checked all ${relay.seen.length} envelopes: none of the ${sentTexts.length} messages could be read in them.`;
  });

  await step('Both phones show the same safety number', async () => {
    const aliSees = await api.safetyNumber(ali.handle, 'Sara', 1);
    const saraSees = await api.safetyNumber(sara.handle, 'Ali', 1);
    const aliBilal = await api.safetyNumber(ali.handle, 'Bilal', 1);
    check(aliSees === saraSees, 'Ali and Sara see different numbers');
    check(aliSees !== aliBilal, 'Two different chats have the same number');
    return `Ali and Sara both see ${aliSees.slice(0, 15)}…`;
  });

  await step('A changed or repeated message is refused', async () => {
    const sealed = await api.encrypt(ali.handle, 'Sara', 1, 'Original');
    // Change one byte in the middle, as an attacker on the network might.
    const raw = atob(sealed.body);
    const i = Math.floor(raw.length / 2);
    const changed = raw.slice(0, i) + String.fromCharCode(raw.charCodeAt(i) ^ 1) + raw.slice(i + 1);
    const tampered = await rejects(api.decrypt(sara.handle, 'Ali', 1, { type: sealed.type, body: btoa(changed) }));
    check(tampered.rejected, 'A changed message was accepted');
    check((await api.decrypt(sara.handle, 'Ali', 1, sealed)) === 'Original', 'The real message did not open after the fake one');
    const again = await rejects(api.decrypt(sara.handle, 'Ali', 1, sealed));
    check(again.rejected && again.code === 'ERR_DUPLICATE', `A repeated 1-to-1 message was not refused (${again.code})`);

    const body = await api.groupEncrypt(bilal.handle, GROUP, 'Group original');
    await api.groupDecrypt(ali.handle, 'Bilal', 1, body);
    const groupAgain = await rejects(api.groupDecrypt(ali.handle, 'Bilal', 1, body));
    check(groupAgain.rejected && groupAgain.code === 'ERR_DUPLICATE', `A repeated group message was not refused (${groupAgain.code})`);
    return 'The library refused a changed message, and refused the same message twice.';
  });

  await step('A message sent twice shows once', async () => {
    const before = sara.inbox.length;
    const envelope = await ali.sendText('Sara', 'Only once please');
    await settle();
    relay.resend(envelope);
    await settle();
    check(sara.inbox.length === before + 1, `Sara has ${sara.inbox.length - before} copies`);
    return 'The server pushed it twice; Sara shows it once.';
  });

  return steps;
}
