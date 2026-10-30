// The real website in a real browser, linked by a pretend phone (the shared
// core in Node) against the real test server. Start both first:
//
//   cd server && MIX_ENV=test mix run --no-start test/e2e_server.exs
//   cd web && VITE_SERVER_URL=http://localhost:4002 npx vite --port 5173
//
// then: cd web && npm run test:e2e
// Screenshots go to web/e2e/shots (not kept in git).

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

import { approveQr, exportHistory, HttpServer, lockProvision, PakChat, phoenixConnection, type FileUploader, type Message } from '@pakchat/shared';
import { lockFile } from '@pakchat/shared/web';
import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, expect, test } from 'vitest';

import { MemoryStorage } from '../../shared/src/storage';
import { make } from '../../shared/test/signals';

const HTTP = 'http://localhost:4002';
const HELPER = 'http://localhost:4003';
const SITE = process.env.PAKCHAT_SITE ?? 'http://localhost:5173';
const SHOTS = new URL('./shots/', import.meta.url).pathname;

const files = new Map<string, Uint8Array>();
const uploader = (server: HttpServer): FileUploader => ({
  async upload(chatId, local) {
    const { locked, key, digest } = await lockFile(files.get(local)!);
    const { id, uploadUrl } = await server.startUpload(chatId, locked.length);
    await fetch(uploadUrl, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: locked as BodyInit });
    return { id, key, digest };
  },
});

async function phone(name: string) {
  const server = new HttpServer(HTTP);
  const signal = make.node();
  const storage = new MemoryStorage();
  const client = new PakChat({ signal, storage, server, connect: phoenixConnection(HTTP.replace(/^http/, 'ws') + '/socket'), deviceName: 'Pixel 7', files: uploader(server) });
  const res = await fetch(`${HELPER}/google_token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, key: `${name}-${Date.now()}` }) });
  const { id_token } = (await res.json()) as { id_token: string };
  const s = await client.signIn(id_token);
  await new Promise<void>((resolve) => {
    const off = client.on('connection', (c) => c && (off(), resolve()));
    client.start();
  });
  return { name, client, signal, storage, server, id: s.userId };
}

async function eventually(check: () => Promise<void>, ms = 15_000) {
  const end = Date.now() + ms;
  for (;;) {
    try {
      return await check();
    } catch (err) {
      if (Date.now() > end) throw err;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

const texts = async (p: { client: PakChat }, chatId: string) => (await p.client.messages(chatId, { limit: 500 })).filter((m: Message) => m.kind === 'text').map((m) => m.text);

type Phone = Awaited<ReturnType<typeof phone>>;

/** What the app does after a website links (app/src/core/linking.ts): forget any old lock for its number, then send the chats. */
async function sendHistory(p: Phone, deviceId: number) {
  // off
  const self = await p.client.openDirect(p.id);
  const parts = await exportHistory(p.storage, { valueKeys: [] });
  for (const [i, b] of parts.entries()) {
    const { locked, key, digest } = await lockFile(new TextEncoder().encode(JSON.stringify(b)));
    const { id, uploadUrl } = await p.server.startUpload(self.id, locked.length);
    await fetch(uploadUrl, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: locked as BodyInit });
    await p.client.sendHistory(self.id, deviceId, { part: b.part, last: i === parts.length - 1, file: { id, key, digest, size: locked.length } });
  }
}
let ali: Phone;
let sara: Phone;
let chat: Awaited<ReturnType<PakChat['openDirect']>>;
let group: Awaited<ReturnType<PakChat['createGroup']>>;
let browser: Browser;
let page: Page;
const errors: string[] = [];

beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, permissions: ['microphone'] });
  // A browser that hasn't been asked about notifications yet (headless says "denied").
  await page.addInitScript(() => {
    let state: NotificationPermission = 'default';
    Object.defineProperty(Notification, 'permission', { get: () => state });
    Notification.requestPermission = async () => (state = 'granted');
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
});

afterAll(async () => {
  await browser?.close();
});

test('a phone links the website by QR, its chats arrive, and the website chats with the phone off', async () => {
  ali = await phone('Ali Khan');
  sara = await phone('Sara Ahmed');
  chat = await ali.client.openDirect(sara.id);
  for (const t of ['Salam Sara!', 'Kal university aa rahi ho?']) await ali.client.sendText(chat.id, t);
  await sara.client.sendText(chat.id, 'Haan, 11 baje tak *pakka*');
  await eventually(async () => expect(await texts(ali, chat.id)).toHaveLength(3));
  group = await ali.client.createGroup('FAST CS-B', [sara.id]);
  await ali.client.sendText(group.id, 'Group mein sab ko salam 👋');

  // The QR page.
  await page.goto(SITE);
  const qrBox = page.locator('[data-qr^="PAKCHAT1,"]');
  await qrBox.waitFor({ timeout: 20_000 });
  await page.screenshot({ path: `${SHOTS}1-qr.png` });
  const qr = (await qrBox.getAttribute('data-qr'))!;

  // Ali's phone scans it and says yes.
  const identityKey = (await ali.signal.deviceKeys(ali.client.me!.handle)).identityKey;
  const approved = await approveQr(ali.server, qr, { v: 1, userId: ali.id, identityKey, phoneName: 'Pixel 7' }, lockProvision);
  expect(approved?.deviceId).toBe(2);
  await page.locator('.loading b').waitFor({ timeout: 15_000 });
  await page.screenshot({ path: `${SHOTS}2-loading.png` });

  // The phone sends its chats through "Message yourself", locked for the website alone.
  await sendHistory(ali, approved!.deviceId);

  // The chat list fills in.
  const row = page.locator('.row', { hasText: 'Sara Ahmed' });
  await row.waitFor({ timeout: 20_000 });
  await page.locator('.row', { hasText: 'FAST CS-B' }).waitFor();
  await page.locator('.nbanner').waitFor();
  await page.screenshot({ path: `${SHOTS}3-list.png` });
  // "Get notified of new messages" shows until notifications are turned on.
  await page.locator('.nbanner', { hasText: 'Turn on desktop notifications' }).click();
  await eventually(async () => expect(await page.locator('.nbanner').count()).toBe(0));

  // Open the chat: the phone's messages are there.
  await row.click();
  await page.locator('.bub', { hasText: 'Kal university aa rahi ho?' }).waitFor();
  expect(await page.locator('.bub strong', { hasText: 'pakka' }).count()).toBe(1);
  await page.screenshot({ path: `${SHOTS}4-chat.png` });

  // Typing and Enter sends it; Sara gets it.
  await page.locator('textarea.ta').fill('Website se salam! 💻');
  await page.keyboard.press('Enter');
  await eventually(async () => expect(await texts(sara, chat.id)).toContain('Website se salam! 💻'));
  // Ali's phone gets a copy too (it's the same account).
  await eventually(async () => expect(await texts(ali, chat.id)).toContain('Website se salam! 💻'));

  // The phone goes off. The website still sends and receives.
  ali.client.stop();
  await sara.client.sendText(chat.id, 'Phone band hai phir bhi chal raha hai?');
  await page.locator('.bub', { hasText: 'Phone band hai phir bhi' }).waitFor({ timeout: 15_000 });
  await page.locator('textarea.ta').fill('Haan! Bilkul 😄');
  await page.keyboard.press('Enter');
  await eventually(async () => expect(await texts(sara, chat.id)).toContain('Haan! Bilkul 😄'));
  await sara.client.markRead(chat.id);
  await page.locator('.mrow.out', { hasText: 'Haan! Bilkul' }).locator('.tk.read').waitFor({ timeout: 15_000 });
  await page.screenshot({ path: `${SHOTS}5-phone-off.png` });

  // Sara sends a photo: the website downloads it, unlocks it and shows it.
  const photo = await page.screenshot({ clip: { x: 500, y: 0, width: 400, height: 300 } });
  files.set('sara-photo', new Uint8Array(photo));
  await sara.client.sendFile(chat.id, { kind: 'image', mime: 'image/png', size: photo.length, width: 400, height: 300, local: 'sara-photo' }, { caption: 'Campus ka view' });
  await page.locator('.bub', { hasText: 'Campus ka view' }).locator('img.full').waitFor({ timeout: 20_000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}5b-photo-in.png` });

  // The website sends a photo back: the preview, a caption, Send; Sara gets it.
  await page.locator('input[type=file][accept^="image"]').setInputFiles({ name: 'notes.png', mimeType: 'image/png', buffer: photo });
  await page.locator('.sendpv').waitFor();
  await page.locator('.sendpv .spcap input').fill('Ye lo notes');
  await page.screenshot({ path: `${SHOTS}5c-send-preview.png` });
  await page.locator('.sendpv .send').click();
  await eventually(async () => {
    const m = (await sara.client.messages(chat.id, { limit: 50 })).find((x) => x.text === 'Ye lo notes');
    expect(m?.kind).toBe('file');
    expect(m?.file?.kind).toBe('image');
    expect(m?.file?.id).not.toBe('pending');
  }, 20_000);
  await page.locator('.bub', { hasText: 'Ye lo notes' }).locator('img.full').waitFor({ timeout: 15_000 });

  // A voice note (the browser's pretend microphone): Sara gets a voice message with its length.
  await page.locator('button[aria-label="Voice message"]').click();
  await page.waitForTimeout(1500);
  // Pause for a while (that time doesn't count), listen back, then carry on.
  await page.locator('button[aria-label="Pause recording"]').click();
  await page.locator('button[aria-label="Play recording"]').click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}5d-recording-paused.png` });
  await page.locator('button[aria-label="Continue recording"]').click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${SHOTS}5d-recording.png` });
  await page.locator('button[aria-label="Send voice message"]').click();
  await eventually(async () => {
    const m = (await sara.client.messages(chat.id, { limit: 50 })).find((x) => x.file?.kind === 'voice');
    expect(m?.file?.duration).toBeGreaterThan(2000);
    expect(m?.file?.duration).toBeLessThan(3400);
    const bars = Buffer.from(m?.file?.waveform ?? '', 'base64');
    expect(bars.length).toBeGreaterThan(10);
    expect(Math.max(...bars)).toBeGreaterThan(20);
  }, 20_000);
  await page.locator('.mrow.out .voice').last().waitFor();
  await page.screenshot({ path: `${SHOTS}5e-voice.png` });

  // Right-click a message: the reaction bar and the menu.
  await page.locator('.bub', { hasText: 'Phone band hai phir bhi' }).click({ button: 'right' });
  await page.locator('.menu .rxrow').waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}6-menu.png` });
  await page.locator('.rxrow button', { hasText: '❤️' }).click();
  await eventually(async () => {
    const m = (await sara.client.messages(chat.id, { limit: 50 })).find((x) => x.text?.startsWith('Phone band'));
    expect(m?.reactions?.[ali.id]).toBe('❤️');
  });

  // Contact info and the security code.
  await page.locator('.hwho').click();
  await page.locator('.drawer', { hasText: 'Contact info' }).waitFor();
  await page.locator('.drow', { hasText: 'Encryption' }).click();
  await page.locator('.code span:not(.spin)').first().waitFor();
  expect(await page.locator('.code span').allTextContents()).toHaveLength(12);
  for (const g of await page.locator('.code span').allTextContents()) expect(g).toMatch(/^\d{5}$/);
  await page.screenshot({ path: `${SHOTS}7-verify.png` });

  // The group, and Settings.
  await page.keyboard.press('Escape');
  await page.locator('.row', { hasText: 'FAST CS-B' }).click();
  await page.locator('.bub', { hasText: 'Group mein sab ko salam' }).waitFor();
  await page.screenshot({ path: `${SHOTS}7b-group.png` });
  await page.locator('button[aria-label="Settings"]').first().click();
  await page.locator('.side', { hasText: 'Settings' }).first().waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}7c-settings.png` });
  await page.locator('button[aria-label="Chats"]').first().click();

  // Reload: still logged in, chats still here (kept in this browser), and still live.
  await page.reload();
  await page.locator('.row', { hasText: 'Sara Ahmed' }).waitFor({ timeout: 20_000 });
  expect(await page.locator('[data-qr]').count()).toBe(0);
  await page.locator('.row', { hasText: 'Sara Ahmed' }).click();
  await page.locator('.bub', { hasText: 'Ye lo notes' }).waitFor();
  await sara.client.sendText(chat.id, 'Reload ke baad bhi?');
  await page.locator('.bub', { hasText: 'Reload ke baad bhi?' }).waitFor({ timeout: 15_000 });

  // Dark theme.
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.screenshot({ path: `${SHOTS}8-dark.png` });

  expect(errors.filter((e) => !e.includes('favicon'))).toEqual([]);
}, 120_000);

test('everyday actions: reply, edit, delete for everyone, forward, star, search, archive, pin, typing, log out', async () => {
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  // A chat's row by its name (not its preview line, which can name people too).
  const row = (name: string) => page.locator('.rows .row').filter({ has: page.locator('.nm', { hasText: name }) }).first();
  const bub = (text: string) => page.locator('.bub', { hasText: text }).last();
  const box = page.locator('textarea.ta');
  const pick = (label: string) => page.locator('.layer .menu .mi', { hasText: label }).first().click();
  const menuOn = async (text: string) => {
    await bub(text).click({ button: 'right' });
    await page.locator('.menu.msgm').waitFor();
  };
  const saraHas = (chatId: string, check: (m: Message) => boolean) =>
    eventually(async () => expect((await sara.client.messages(chatId, { limit: 200 })).some(check)).toBe(true), 15_000);
  await row('Sara Ahmed').click();

  // Reply: Sara's copy points at the message it answers.
  await menuOn('Reload ke baad bhi?');
  await pick('Reply');
  await page.locator('.replybar, .cbar').first().waitFor();
  await box.fill('Haan reload ke baad bhi');
  await page.keyboard.press('Enter');
  const asked = (await sara.client.messages(chat.id, { limit: 200 })).find((m) => m.text === 'Reload ke baad bhi?')!;
  await saraHas(chat.id, (m) => m.text === 'Haan reload ke baad bhi' && m.replyTo?.id === asked.id);
  await bub('Haan reload ke baad bhi').locator('.quote').waitFor();

  // Edit it: Sara sees the new words, marked Edited.
  // (Edit shows once the server has it.)
  await bub('Haan reload ke baad bhi').locator('.tk[aria-label="Sent"], .tk[aria-label="Delivered"], .tk[aria-label="Read"]').waitFor();
  await menuOn('Haan reload ke baad bhi');
  await pick('Edit');
  await box.fill('Haan, reload ke baad bhi chal raha hai');
  await page.keyboard.press('Enter');
  await saraHas(chat.id, (m) => m.text === 'Haan, reload ke baad bhi chal raha hai' && !!m.editedAt);
  await bub('reload ke baad bhi chal raha hai').locator('text=Edited').waitFor();

  // Delete for everyone: gone for Sara too.
  await box.fill('Galti se bheja');
  await page.keyboard.press('Enter');
  await saraHas(chat.id, (m) => m.text === 'Galti se bheja');
  await menuOn('Galti se bheja');
  await pick('Delete');
  await page.locator('.dialog button', { hasText: 'Delete for everyone' }).click();
  await saraHas(chat.id, (m) => m.author === ali.id && !!m.deleted);
  await page.locator('.bub', { hasText: 'You deleted this message' }).waitFor();

  // Star a photo, then find it under Starred messages.
  await menuOn('Campus ka view');
  await pick('Star');
  await page.locator('.side button[aria-label="Menu"]').click();
  await pick('Starred messages');
  await page.locator('.starred', { hasText: 'Campus ka view' }).waitFor();
  await page.screenshot({ path: `${SHOTS}9-starred.png` });
  await page.locator('.side button[aria-label="Back"]').click();

  // Forward a message to the group: it arrives there marked Forwarded.
  await menuOn('Phone band hai phir bhi');
  await pick('Forward');
  await page.locator('.fwd .row', { hasText: 'FAST CS-B' }).click();
  await page.locator('.fwd .go').click();
  await saraHas(group.id, (m) => m.text === 'Phone band hai phir bhi chal raha hai?' && !!m.forwarded);

  // Search finds chats by name and messages by their words.
  const search = page.locator('.side .search input');
  await search.fill('univer');
  await page.locator('.row.msr', { hasText: 'Kal university aa rahi ho?' }).waitFor();
  await page.screenshot({ path: `${SHOTS}10-search.png` });
  await page.locator('.row.msr', { hasText: 'Kal university aa rahi ho?' }).click();
  await page.locator('.mrow.flash', { hasText: 'Kal university' }).waitFor();
  await search.fill('');

  // Archive the group from its row's menu, find it under Archived, bring it back.
  await row('FAST CS-B').hover();
  await row('FAST CS-B').locator('.chev').click();
  await pick('Archive chat');
  await page.locator('.arch').waitFor();
  expect(await page.locator('.rows .row', { hasText: 'FAST CS-B' }).count()).toBe(0);
  await page.locator('.arch').click();
  await row('FAST CS-B').hover();
  await row('FAST CS-B').locator('.chev').click();
  await pick('Unarchive chat');
  await page.locator('.side button[aria-label="Back"]').click();
  await row('FAST CS-B').waitFor();

  // Pin the group: it goes to the top even though Sara's chat is newer.
  await row('FAST CS-B').click({ button: 'right' });
  await pick('Pin chat');
  await eventually(async () => expect(await page.locator('.rows .row').first().textContent()).toContain('FAST CS-B'));

  // Select chats: tick both, mute them together, then unmute them together.
  await page.locator('.side button[aria-label="Menu"]').click();
  await pick('Select chats');
  await row('FAST CS-B').click();
  await row('Sara Ahmed').click();
  await page.locator('.pickh .selcount', { hasText: '2 selected' }).waitFor();
  await page.screenshot({ path: `${SHOTS}11a-select-chats.png` });
  await page.locator('.pickh button[aria-label="Mute"]').click();
  await page.locator('.dialog .btn', { hasText: 'Mute' }).click();
  await page.locator('.pickh').waitFor({ state: 'detached' });
  await eventually(async () => expect(await page.locator('.rows .row .ics > svg').count()).toBe(3)); // two muted, one pin
  await page.locator('.side button[aria-label="Menu"]').click();
  await pick('Select chats');
  await row('FAST CS-B').click();
  await row('Sara Ahmed').click();
  await page.locator('.pickh button[aria-label="Unmute"]').click();
  await page.locator('.pickh').waitFor({ state: 'detached' });
  await eventually(async () => expect(await page.locator('.rows .row .ics > svg').count()).toBe(1)); // just the pin

  // Sara typing shows in her row and in the chat's header.
  await row('Sara Ahmed').click();
  sara.client.typing(chat.id, true);
  await page.locator('.chd', { hasText: 'typing…' }).first().waitFor({ timeout: 10_000 });
  await page.screenshot({ path: `${SHOTS}11-typing.png` });
  sara.client.typing(chat.id, false);

  // Notifications: a message in another chat shows one (WhatsApp's wording), with the group's name for groups.
  await page.evaluate(() => {
    const shown: { title: string; body?: string }[] = [];
    (window as unknown as { shown: typeof shown }).shown = shown;
    class Fake {
      static permission = 'granted';
      onclick: (() => void) | null = null;
      constructor(title: string, o: NotificationOptions) {
        shown.push({ title, body: o.body });
      }
      close() {}
    }
    (window as unknown as { Notification: unknown }).Notification = Fake;
  });
  await page.keyboard.press('Escape');
  await page.locator('main .empty, .empty').first().waitFor();
  await sara.client.sendText(chat.id, 'Notification aayi?');
  await sara.client.sendText(group.id, 'Group wali bhi?');
  await eventually(async () =>
    expect(await page.evaluate(() => (window as unknown as { shown: unknown[] }).shown)).toEqual([
      { title: 'Sara Ahmed', body: 'Notification aayi?' },
      { title: 'FAST CS-B', body: 'Sara Ahmed: Group wali bhi?' },
    ]),
  );
  // The tab's icon shows the unread count.
  await eventually(async () => expect(await page.title()).toMatch(/^\(\d+\) PakChat$/));
  await eventually(async () => expect(await page.locator('link[rel="icon"]').getAttribute('href')).toMatch(/^data:image\/png/));
  const icon = (await page.locator('link[rel="icon"]').getAttribute('href'))!;
  writeFileSync(`${SHOTS}11b-tab-icon.png`, Buffer.from(icon.split(',')[1], 'base64'));
  // Not for the chat I'm looking at.
  await row('FAST CS-B').click();
  await sara.client.sendText(group.id, 'Ye wali nahi');
  await page.locator('.bub', { hasText: 'Ye wali nahi' }).waitFor();
  expect(await page.evaluate(() => (window as unknown as { shown: unknown[] }).shown.length)).toBe(2);

  // Message info: Sara has read my message.
  await row('Sara Ahmed').click();
  await menuOn('Haan! Bilkul');
  await pick('Message info');
  await page.locator('.drawer .misec', { hasText: 'Read' }).filter({ hasText: 'Sara Ahmed' }).waitFor();
  await page.screenshot({ path: `${SHOTS}13-message-info.png` });
  await page.keyboard.press('Escape');

  // Select two messages and star both.
  await menuOn('Salam Sara!');
  await pick('Select');
  await bub('Kal university aa rahi ho?').click();
  await page.locator('.selbar .selcount', { hasText: '2 selected' }).waitFor();
  await page.screenshot({ path: `${SHOTS}14-select.png` });
  await page.locator('.selbar button[aria-label="Star"]').click();
  await page.locator('.selbar').waitFor({ state: 'detached' });
  await bub('Salam Sara!').locator('.meta svg').first().waitFor();
  expect(await page.evaluate(() => document.querySelectorAll('.mrow.sel').length)).toBe(0);

  // Pin a message: the bar shows under the header, and Sara's copy is pinned too.
  await menuOn('Kal university aa rahi ho?');
  await pick('Pin');
  await page.locator('.pinbar', { hasText: 'Kal university' }).waitFor();
  await saraHas(chat.id, (m) => m.text === 'Kal university aa rahi ho?' && !!m.pinnedUntil && m.pinnedUntil > Date.now());
  await page.screenshot({ path: `${SHOTS}15-pinned.png` });

  // In the group: @mention Sara, then reply privately to her group message.
  await row('FAST CS-B').click();
  await box.fill('');
  await box.pressSequentially('@Sa');
  await page.locator('.mentions button', { hasText: 'Sara Ahmed' }).waitFor();
  await page.screenshot({ path: `${SHOTS}16-mention.png` });
  await page.keyboard.press('Enter');
  expect(await box.inputValue()).toBe('@Sara Ahmed ');
  await box.pressSequentially('dekho ye');
  await page.keyboard.press('Enter');
  await saraHas(group.id, (m) => m.text === '@Sara Ahmed dekho ye' && !!m.mentions?.includes(sara.id));
  await bub('dekho ye').locator('.mention', { hasText: '@Sara Ahmed' }).waitFor();
  await menuOn('Group wali bhi?');
  await pick('Reply privately');
  await page.locator('.replybar', { hasText: 'FAST CS-B' }).waitFor();
  await box.fill('Private mein bata rahi hoon');
  await page.keyboard.press('Enter');
  await saraHas(chat.id, (m) => m.text === 'Private mein bata rahi hoon' && m.quote?.chat === group.id);
  await page.screenshot({ path: `${SHOTS}17-private-reply.png` });

  // The + menu: a poll, an event, and a photo from the camera (the browser's pretend one).
  const attach = async (label: string) => {
    await page.locator('button[aria-label="Attach"]').click();
    await pick(label);
  };
  await attach('Poll');
  await page.locator('.dialog', { hasText: 'Create poll' }).waitFor();
  await page.locator('.dialog .dinput').first().fill('Kal chhutti hai?');
  await page.locator('.dialog .dinput.opt').nth(0).fill('Haan');
  await page.locator('.dialog .dinput.opt').nth(1).fill('Nahi');
  await page.screenshot({ path: `${SHOTS}18-poll.png` });
  await page.locator('.dialog .btn', { hasText: 'Send' }).click();
  await saraHas(chat.id, (m) => m.kind === 'poll' && m.poll?.question === 'Kal chhutti hai?' && m.poll.options.join() === 'Haan,Nahi');

  await attach('Event');
  await page.locator('.dialog .dinput').first().fill('Study group');
  await page.locator('.dialog input[placeholder^="Location"]').fill('Library');
  await page.locator('.dialog .btn', { hasText: 'Send' }).click();
  await saraHas(chat.id, (m) => m.kind === 'event' && m.plan?.title === 'Study group' && m.plan.place === 'Library' && m.plan.at > Date.now());
  await bub('Study group').waitFor();

  await attach('Camera');
  await page.locator('.camera video').waitFor();
  await page.waitForFunction(() => (document.querySelector('.camera video') as HTMLVideoElement | null)?.videoWidth);
  await page.locator('.camera .snap').click();
  await page.locator('.sendpv').waitFor();
  await page.locator('.sendpv .send').click();
  await saraHas(chat.id, (m) => m.file?.kind === 'image' && m.file.mime === 'image/jpeg' && m.file.id !== 'pending');
  await page.screenshot({ path: `${SHOTS}19-after-attach.png` });

  // Profile: change my name, about and photo here; the server (and so the phone) has them.
  await page.locator('.rail button[aria-label="Profile"]').click();
  await page.locator('.pphoto').waitFor();
  await page.locator('button[aria-label="Edit name"]').click();
  await page.locator('.prow.editing input').fill('Ali Web');
  await page.keyboard.press('Enter');
  await eventually(async () => expect((await ali.server.me()).name).toBe('Ali Web'));
  await page.locator('button[aria-label="Edit about"]').click();
  await page.locator('.prow.editing input').fill('Website se about');
  await page.locator('.prow.editing button[aria-label="Save"]').click();
  await eventually(async () => expect((await ali.server.me()).about).toBe('Website se about'));
  const picture = await page.screenshot({ clip: { x: 500, y: 100, width: 600, height: 400 } });
  await page.locator('.pphoto').click();
  await pick('Upload photo');
  await page.locator('.pbody input[type=file]').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: picture });
  await page.locator('.crop img[style*="translate"]').waitFor();
  await page.locator('button[aria-label="Zoom in"]').click();
  await page.screenshot({ path: `${SHOTS}20-crop.png` });
  await page.locator('.dialog .btn', { hasText: 'Save' }).click();
  await page.locator('.pphoto .av.ph img').waitFor();
  await eventually(async () => expect((await ali.server.me()).photo).toMatch(/^pk1:/));
  expect(await page.locator('.rail .me img').count()).toBe(1);
  await page.screenshot({ path: `${SHOTS}20-profile.png` });
  await page.locator('.pphoto').click();
  await pick('Remove photo');
  await page.locator('.dialog .btn', { hasText: 'Remove' }).click();
  await eventually(async () => expect((await ali.server.me()).photo ?? null).toBeNull());
  await page.locator('.rail button[aria-label="Chats"]').click();

  // Small and big windows: nothing spills, nothing scrolls sideways.
  for (const [w, h] of [[800, 600], [1024, 700], [1920, 1080]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}12-size-${w}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  // Log out: back to the QR, and nothing of Ali's is left in this browser.
  await page.locator('.side button[aria-label="Menu"]').click();
  await pick('Log out');
  await page.locator('.dialog button', { hasText: 'Log out' }).click();
  await page.locator('[data-qr^="PAKCHAT1,"]').waitFor({ timeout: 20_000 });
  const left = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const req = indexedDB.open('pakchat');
        req.onsuccess = () => {
          const db = req.result;
          const t = db.transaction('messages').objectStore('messages').count();
          t.onsuccess = () => resolve(t.result);
        };
      }),
  );
  expect(left).toBe(0);

  // Logged out from the phone (Linked devices › Log out): the website notices and shows the QR again.
  const again = (await page.locator('[data-qr^="PAKCHAT1,"]').getAttribute('data-qr'))!;
  const identityKey = (await ali.signal.deviceKeys(ali.client.me!.handle)).identityKey;
  const linked = await approveQr(ali.server, again, { v: 1, userId: ali.id, identityKey, phoneName: 'Pixel 7' }, lockProvision);
  await page.locator('[data-qr^="PAKCHAT1,"]').waitFor({ state: 'detached', timeout: 15_000 });
  // Linked again, it gets the number the first website had, and the phone's chats still arrive.
  expect(linked!.deviceId).toBe(2);
  await new Promise<void>((resolve) => {
    const off = ali.client.on('connection', (c) => c && (off(), resolve()));
    ali.client.start();
  });
  await sendHistory(ali, linked!.deviceId);
  await page.locator('.row[aria-label="Sara Ahmed"]').waitFor({ timeout: 20_000 });
  await page.screenshot({ path: `${SHOTS}21-relinked.png` });
  await ali.server.removeDevice(linked!.deviceId);
  await page.locator('[data-qr^="PAKCHAT1,"]').waitFor({ timeout: 40_000 });

  // The refused connection and the "still logged in?" check show as 403 and 401 in the console.
  expect(errors.filter((e) => !e.includes('favicon') && !e.includes('401') && !e.includes('403'))).toEqual([]);
}, 180_000);
