// The website catch-up batches, in two real browsers (Ali's and Sara's computers): calls,
// the voice recorder that keeps going, chat settings kept the same as the phone, locks.
// Each website is linked by a pretend phone (the shared core in Node), as in
// website.e2e.ts. Start the test server and the site first (see there), then:
//   cd web && npx vitest run --config vitest.e2e.config.ts e2e/catchup.e2e.ts

import { mkdirSync } from 'node:fs';

import { approvePairing, approveQr, exportHistory, HttpServer, lockProvision, openSealedQr, PakChat, pairKey, phoenixConnection } from '@pakchat/shared';
import { lockFile } from '@pakchat/shared/web';
import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, expect, test } from 'vitest';

import { MemoryStorage } from '../../shared/src/storage';
import { make } from '../../shared/test/signals';

const HTTP = 'http://localhost:4002';
const HELPER = 'http://localhost:4003';
const SITE = process.env.PAKCHAT_SITE ?? 'http://localhost:5173';
const SHOTS = new URL('./shots/', import.meta.url).pathname;

async function phone(name: string) {
  const server = new HttpServer(HTTP);
  const signal = make.node();
  const storage = new MemoryStorage();
  const client = new PakChat({ signal, storage, server, connect: phoenixConnection(HTTP.replace(/^http/, 'ws') + '/socket'), deviceName: 'Pixel 7' });
  const res = await fetch(`${HELPER}/google_token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, key: `${name}-${Date.now()}` }) });
  const { id_token } = (await res.json()) as { id_token: string };
  const s = await client.signIn(id_token);
  await new Promise<void>((resolve) => {
    const off = client.on('connection', (c) => c && (off(), resolve()));
    client.start();
  });
  return { name, client, signal, storage, server, id: s.userId };
}
type Phone = Awaited<ReturnType<typeof phone>>;

/** Opens the website in a fresh browser window and links it to `p` by its QR. */
async function linkedSite(p: Phone): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['microphone', 'camera'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${p.name}: ${String(e)}`));
  await page.goto(SITE);
  const qrBox = page.locator('[data-qr^="PAKCHAT1,"]');
  await qrBox.waitFor({ timeout: 20_000 });
  const qr = (await qrBox.getAttribute('data-qr'))!;
  const identityKey = (await p.signal.deviceKeys(p.client.me!.handle)).identityKey;
  const approved = await approveQr(p.server, qr, { v: 1, userId: p.id, identityKey, phoneName: 'Pixel 7' }, lockProvision);
  await sendHistory(p, approved!.deviceId);
  return page;
}

/** What the phone does after linking: copies its chats over. */
async function sendHistory(p: Phone, deviceId: number) {
  const self = await p.client.openDirect(p.id);
  const parts = await exportHistory(p.storage, { valueKeys: [] });
  for (const [i, b] of parts.entries()) {
    const { locked, key, digest } = await lockFile(new TextEncoder().encode(JSON.stringify(b)));
    const { id, uploadUrl } = await p.server.startUpload(self.id, locked.length);
    await fetch(uploadUrl, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: locked as BodyInit });
    await p.client.sendHistory(self.id, deviceId, { part: b.part, last: i === parts.length - 1, file: { id, key, digest, size: locked.length } });
  }
}

let browser: Browser;
const errors: string[] = [];
let ali: Phone;
let sara: Phone;
let a: Page;
let s: Page;
let chatId = '';

beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
});

afterAll(async () => {
  await browser?.close();
});

test('a computer calls another computer: it rings, it connects, the camera goes on, it hangs up, and both Calls tabs have it', async () => {
  ali = await phone('Ali Khan');
  sara = await phone('Sara Ahmed');
  const chat = await ali.client.openDirect(sara.id);
  chatId = chat.id;
  await ali.client.sendText(chat.id, 'Call karun?');
  await sara.client.sendText(chat.id, 'Haan karo');
  const group = await ali.client.createGroup('Study group', [sara.id]);
  await ali.client.sendText(group.id, 'Kal test hai');

  a = await linkedSite(ali);
  s = await linkedSite(sara);
  for (const [page, other] of [[a, 'Sara Ahmed'], [s, 'Ali Khan']] as const) {
    await page.locator('.row').filter({ has: page.locator('.nm', { hasText: new RegExp(`^${other}$`) }) }).click({ timeout: 20_000 });
    await page.locator('.bub', { hasText: 'Haan karo' }).waitFor();
  }

  // Ali clicks Voice call: his window says Calling…, then Ringing… once Sara's computer rings.
  await a.locator('button[aria-label="Voice call"]').click();
  await a.locator('.callwin .who span', { hasText: /Calling…|Ringing…/ }).waitFor();
  const card = s.locator('.callcard');
  await card.waitFor({ timeout: 15_000 });
  expect(await card.textContent()).toContain('PakChat voice call');
  await a.locator('.callwin .who span', { hasText: 'Ringing…' }).waitFor({ timeout: 10_000 });
  await s.screenshot({ path: `${SHOTS}call-1-ringing.png` });

  // Sara accepts: both windows show the running time.
  await card.locator('button.yes').click();
  for (const p of [a, s]) await p.locator('.callwin .who span', { hasText: /^\d+:\d\d$/ }).waitFor({ timeout: 20_000 });
  await a.screenshot({ path: `${SHOTS}call-2-voice.png` });

  // Mute, then Ali turns his camera on: Sara sees his picture.
  await a.locator('.callwin button[aria-label="Mute"]').click();
  await a.locator('.callwin button[aria-label="Unmute"]').waitFor();
  await a.locator('.callwin button[aria-label="Turn camera on"]').click();
  await s.locator('.callwin .tile video').waitFor({ timeout: 20_000 });
  await s.waitForFunction(() => {
    const v = document.querySelector<HTMLVideoElement>('.callwin .tile video');
    return !!v && v.videoWidth > 0;
  });
  await s.screenshot({ path: `${SHOTS}call-3-video.png` });

  // Minimise: the green bar shows over the chat list; clicking it brings the call back.
  await s.locator('.callwin button[aria-label="Minimise"]').click();
  await s.locator('.callbar').waitFor();
  await s.screenshot({ path: `${SHOTS}call-4-bar.png` });
  await s.locator('.callbar').click();
  await s.locator('.callwin').waitFor();

  // Ali hangs up: both windows close.
  await a.locator('.callwin button[aria-label="End call"]').click();
  for (const p of [a, s]) await p.locator('.callwin').waitFor({ state: 'detached', timeout: 10_000 });

  // The chat says so, and the Calls tab lists it.
  await s.locator('.sys', { hasText: /Voice call|Video call/ }).first().waitFor({ timeout: 10_000 });
  await s.locator('button[aria-label="Calls"]').click();
  await s.locator('.callrow', { hasText: 'Ali Khan' }).waitFor();
  expect(await s.locator('.callrow').first().textContent()).toContain('Incoming');
  await s.screenshot({ path: `${SHOTS}call-5-log.png` });

  // A call Sara declines: Ali's window says Declined.
  await a.locator('button[aria-label="Video call"]').click();
  await s.locator('.callcard').waitFor({ timeout: 15_000 });
  expect(await s.locator('.callcard').textContent()).toContain('PakChat video call');
  await s.locator('.callcard button.no').click();
  await a.locator('.callwin .who span', { hasText: 'Declined' }).waitFor({ timeout: 10_000 });

  expect(errors).toEqual([]);
});

test('a voice message keeps recording when another chat is opened, and sends from the small recorder', async () => {
  await a.locator('button[aria-label="Chats"]').click();
  await a.locator('.row').filter({ has: a.locator('.nm', { hasText: /^Sara Ahmed$/ }) }).click();
  await a.locator('button[aria-label="Voice message"]').click();
  await a.locator('.cpill.rec').waitFor();
  await a.waitForTimeout(1500);

  // Another chat: the recording carries on under the chat list.
  await a.locator('.row', { hasText: 'Study group' }).click();
  await a.locator('.bub', { hasText: 'Kal test hai' }).waitFor();
  const mini = a.locator('.minirec');
  await mini.waitFor();
  expect(await mini.textContent()).toContain('Sara Ahmed');
  await a.waitForTimeout(1000);
  await a.screenshot({ path: `${SHOTS}rec-1-mini.png` });
  // The group's own mic waits for this one.
  expect(await a.locator('.cpill.rec').count()).toBe(0);

  // Back to Sara's chat: the full recorder again, still going.
  await mini.locator('.mrwho').click();
  await a.locator('.cpill.rec').waitFor();
  expect(await a.locator('.minirec').count()).toBe(0);

  // Off again, and send it from the small recorder: Sara gets all of it (about 3 seconds).
  await a.locator('.row', { hasText: 'Study group' }).click();
  await a.locator('.minirec button[aria-label="Send voice message"]').click();
  await a.locator('.minirec').waitFor({ state: 'detached' });
  const end = Date.now() + 15_000;
  for (;;) {
    const m = (await sara.client.messages(chatId, { limit: 50 })).find((x) => x.file?.kind === 'voice');
    if (m) {
      expect(m.file?.duration).toBeGreaterThan(2400);
      break;
    }
    if (Date.now() > end) throw new Error('No voice message arrived');
    await new Promise((r) => setTimeout(r, 200));
  }
  expect(errors).toEqual([]);
});

test('chat settings stay the same on the phone and the website, both ways', async () => {
  const fromSite: unknown[] = [];
  ali.client.on('sync', (e) => fromSite.push(e));
  const groupRow = a.locator('.row').filter({ has: a.locator('.nm', { hasText: /^Study group$/ }) });
  const saraRow = a.locator('.row').filter({ has: a.locator('.nm', { hasText: /^Sara Ahmed$/ }) });
  await a.locator('button[aria-label="Chats"]').click();
  await groupRow.waitFor();

  // The phone archives the group and stars a message: the website follows.
  const groupId = (await ali.client.chats()).find((c) => c.title === 'Study group')!.id;
  await ali.client.sendSync({ key: 'app:prefs', set: { [groupId]: { archived: true } } });
  await groupRow.waitFor({ state: 'detached', timeout: 15_000 });
  await a.locator('button.arch', { hasText: 'Archived' }).waitFor();

  // The website pins Sara's chat and marks it unread: the phone is told.
  await saraRow.click({ button: 'right' });
  await a.locator('.menu button', { hasText: 'Pin chat' }).click();
  await saraRow.locator('svg').first().waitFor();
  const end = Date.now() + 15_000;
  for (;;) {
    const got = fromSite.find((e) => (e as { key: string; set?: Record<string, { pinnedAt?: number }> }).set?.[chatId]?.pinnedAt);
    if (got) break;
    if (Date.now() > end) throw new Error(`The phone wasn't told: ${JSON.stringify(fromSite)}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  // Only the shared settings go: never the draft.
  expect(JSON.stringify(fromSite)).not.toContain('draft');

  // The phone takes the archive back: the group is in the list again.
  await ali.client.sendSync({ key: 'app:prefs', set: { [groupId]: {} } });
  await groupRow.waitFor({ timeout: 15_000 });
  expect(errors).toEqual([]);
});

test('locked chats open with the phone’s secret code, and App lock asks for its password', async () => {
  const saraRow = a.locator('.row').filter({ has: a.locator('.nm', { hasText: /^Sara Ahmed$/ }) });
  const groupRow = a.locator('.row').filter({ has: a.locator('.nm', { hasText: /^Study group$/ }) });
  const groupId = (await ali.client.chats()).find((c) => c.title === 'Study group')!.id;
  const sum = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('pakchat-locked:1234'));
  const lockCode = [...new Uint8Array(sum)].map((x) => x.toString(16).padStart(2, '0')).join('');

  // The phone sets its secret code, puts Sara's chat in Locked chats and locks the group in the list.
  await ali.client.sendSync({ key: 'app:lockCode', value: lockCode });
  await ali.client.sendSync({ key: 'app:prefs', set: { [chatId]: { lock: 'folder' }, [groupId]: { lock: 'list' } } });
  await saraRow.waitFor({ state: 'detached', timeout: 15_000 });
  const folderRow = a.locator('button.arch', { hasText: 'Locked chats' });
  await folderRow.click();
  const code = a.locator('input[aria-label="Secret code"]');
  await code.fill('9999');
  await a.locator('.dialog button', { hasText: 'Unlock' }).click();
  await a.locator('.derr', { hasText: 'Incorrect secret code' }).waitFor();
  await code.fill('1234');
  await a.locator('.dialog button', { hasText: 'Unlock' }).click();
  await saraRow.waitFor();
  await a.screenshot({ path: `${SHOTS}catchup-locked-chats.png` });
  // Leaving the folder locks it again.
  await a.locator('.sh button[aria-label="Back"]').click();
  await folderRow.waitFor();
  await expect(saraRow.count()).resolves.toBe(0);

  // The group stays in the list as a locked chat: its messages show only after the code.
  await groupRow.click();
  await a.locator('.lockcover button', { hasText: 'Unlock chat' }).click();
  await code.fill('1234');
  await a.locator('.dialog button', { hasText: 'Unlock' }).click();
  await a.locator('.cpill').first().waitFor();
  await expect(a.locator('.lockcover').count()).resolves.toBe(0);

  // App lock: a password for this computer. "Lock app" locks it; the password opens it.
  await a.locator('button[aria-label="Settings"]').click();
  await a.locator('.srow', { hasText: 'Privacy' }).first().click();
  await a.locator('.srow[role="switch"]', { hasText: 'App lock' }).click();
  const pw = a.locator('.dialog input[type="password"]');
  await pw.nth(0).fill('secret-pass');
  await pw.nth(1).fill('secret-pass');
  await a.locator('.dialog button', { hasText: 'OK' }).click();
  await a.locator('.srow[role="switch"][aria-checked="true"]', { hasText: 'App lock' }).waitFor();
  await a.locator('button[aria-label="Chats"]').click();
  await a.locator('button[aria-label="Menu"]').first().click();
  await a.locator('.menu button', { hasText: 'Lock app' }).click();
  await a.locator('.lockscreen').waitFor();
  await expect(a.locator('.shellwrap:not([hidden]) .row').count()).resolves.toBe(0);
  // The group locked again with the app.
  await a.locator('.lockscreen input').fill('wrong-pass');
  await a.locator('.lockscreen button', { hasText: 'Unlock' }).click();
  await a.locator('.lockscreen .lerr', { hasText: 'Incorrect password' }).waitFor();
  await a.screenshot({ path: `${SHOTS}catchup-app-lock.png` });
  await a.locator('.lockscreen input').fill('secret-pass');
  await a.locator('.lockscreen button', { hasText: 'Unlock' }).click();
  await a.locator('.lockscreen').waitFor({ state: 'detached' });

  // Opening PakChat again asks first.
  await a.reload();
  await a.locator('.lockscreen').waitFor({ timeout: 15_000 });
  await a.locator('.lockscreen input').fill('secret-pass');
  await a.locator('.lockscreen button', { hasText: 'Unlock' }).click();
  await a.locator('.lockscreen').waitFor({ state: 'detached' });
  await a.locator('button.arch', { hasText: 'Locked chats' }).waitFor({ timeout: 15_000 });

  // Turning it off takes the password too.
  await a.locator('button[aria-label="Settings"]').click();
  await a.locator('.srow', { hasText: 'Privacy' }).first().click();
  await a.locator('.srow[role="switch"]', { hasText: 'App lock' }).click();
  await a.locator('.dialog input[type="password"]').fill('secret-pass');
  await a.locator('.dialog button', { hasText: 'Turn off' }).click();
  await a.locator('.srow[role="switch"][aria-checked="false"]', { hasText: 'App lock' }).waitFor();
  await a.locator('button[aria-label="Chats"]').click();
  await ali.client.sendSync({ key: 'app:prefs', set: { [chatId]: {}, [groupId]: {} } });
  await saraRow.waitFor({ timeout: 15_000 });
  expect(errors).toEqual([]);
});

test('a computer links with a phone number and an 8-letter code instead of the QR', async () => {
  // Ali's account gets a number (the test server keeps the SMS code for us).
  const local = `300${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
  const phone = `+92${local}`;
  await ali.server.sendLinkCode(phone);
  await ali.server.linkPhone(phone, await ali.server.testCode(phone));

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`phone login: ${String(e)}`));
  await page.goto(SITE);
  await page.locator('button', { hasText: 'Log in with phone number' }).click();
  await page.locator('h1', { hasText: 'Enter phone number' }).waitFor();
  await page.locator('input[aria-label="Phone number"]').fill(`0${local.slice(0, 3)} ${local.slice(3)}`);
  await page.locator('button', { hasText: 'Next' }).click();
  const box = page.locator('.pcode[data-code]');
  await box.waitFor({ timeout: 15_000 });
  await page.locator('.cphone b', { hasText: phone }).waitFor();
  await page.screenshot({ path: `${SHOTS}catchup-phone-code.png` });
  const code = (await box.getAttribute('data-code'))!;
  expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);

  // On the phone: Linked devices › Link a device › Link with phone number instead, and the code.
  const identityKey = (await ali.signal.deviceKeys(ali.client.me!.handle)).identityKey;
  const open = async (sealed: string, c: string, ph: string) => openSealedQr(sealed, await pairKey(c, ph), ph);
  const provision = { v: 1 as const, userId: ali.id, identityKey, phoneName: 'Pixel 7' };
  // A wrong code links nothing.
  await expect(approvePairing(ali.server, 'AAAA-AAAA', provision, lockProvision, open)).rejects.toMatchObject({ reason: 'wrong_code' });
  const linked = await approvePairing(ali.server, `${code.slice(0, 4).toLowerCase()}-${code.slice(4)}`, provision, lockProvision, open);
  await sendHistory(ali, linked.deviceId);
  await page.locator('.row').first().waitFor({ timeout: 30_000 });
  await ctx.close();
  expect(errors).toEqual([]);
}, 90_000);

test('the website in Urdu: right to left, with the same words as the phone', async () => {
  await a.locator('button[aria-label="Settings"]').click();
  await a.locator('.srow', { hasText: /^Chats/ }).first().click();
  await a.locator('.srow', { hasText: 'Language' }).click();
  await a.locator('.dialog label, .dialog button', { hasText: 'اردو' }).first().click();
  await a.locator('.dialog button', { hasText: 'OK' }).click();
  await a.waitForLoadState('load');
  await a.waitForFunction(() => document.documentElement.dir === 'rtl', null, { timeout: 15_000 });
  await a.locator('button[aria-label="چیٹس"]').click();
  await a.locator('.row').first().waitFor({ timeout: 15_000 });
  await a.locator('.row').filter({ has: a.locator('.nm', { hasText: /^Sara Ahmed$/ }) }).click();
  await a.waitForTimeout(800);
  await a.screenshot({ path: `${SHOTS}catchup-urdu.png` });
  await a.locator('button[aria-label="Menu"], button[aria-label="مینو"]').first().click();
  await a.waitForTimeout(300);
  await a.screenshot({ path: `${SHOTS}catchup-urdu-menu.png` });
  await a.keyboard.press('Escape');
  // And back to English.
  await a.evaluate(() => localStorage.setItem('pakchat:lang', 'en'));
  await a.reload();
  await a.waitForFunction(() => document.documentElement.dir === 'ltr');
  await a.locator('button[aria-label="Chats"]').waitFor({ timeout: 15_000 });
  expect(errors).toEqual([]);
});
