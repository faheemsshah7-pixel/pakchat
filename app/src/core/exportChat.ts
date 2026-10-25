// exportChat.ts: Export chat (the chat's ⋮ menu), like WhatsApp's. The chat's
// words go into a .txt file ("25/10/2026, 10:15 - Ali: hello"), and with
// "Include media" its photos, videos, voice notes and files on this phone go
// with it, in one .zip (Kotlin's zipChat). Then Android's share sheet opens.
// Nothing goes to our server: you choose where it goes.
import type { Message } from '@pakchat/shared';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { fileModule } from '../../modules/pakchat-signal';
import type { Strings } from '../i18n';
import { bodyLine, systemText } from '../ui/format';
import { core } from './core';
import { outsideFor } from './lock';

/** At most this many files go in the zip (WhatsApp's limit is about the same). */
const MAX_FILES = 100;
/** And this much in all. */
const MAX_BYTES = 200 * 1024 * 1024;

const two = (n: number) => String(n).padStart(2, '0');
const stamp = (ms: number) => {
  const d = new Date(ms);
  return `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()}, ${two(d.getHours())}:${two(d.getMinutes())}`;
};

/** Every message in the chat, oldest first (read from this phone, a page at a time). */
async function allMessages(chatId: string) {
  const out: Message[] = [];
  let before: number | undefined;
  for (;;) {
    const page = await core.storage.listMessages(chatId, { beforeOrder: before, limit: 500 });
    if (!page.length) break;
    out.unshift(...page);
    if (page.length < 500) break;
    before = page[0].order;
  }
  return out;
}

/** The file's name in the zip: its own name, or one made from when it was sent. */
function nameFor(m: Message, used: Set<string>) {
  const f = m.file!;
  const ext = (/\.([a-z0-9]{1,8})$/i.exec(f.local ?? '')?.[1] ?? 'bin').toLowerCase();
  const d = new Date(m.sentAt);
  const kind = f.kind === 'image' ? 'IMG' : f.kind === 'video' ? 'VID' : f.kind === 'voice' ? 'PTT' : f.kind === 'audio' ? 'AUD' : f.kind === 'sticker' ? 'STK' : 'DOC';
  let name = f.name?.replace(/[\\/:*?"<>|]/g, '_') || `${kind}-${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}.${ext}`;
  for (let n = 2; used.has(name); n++) name = name.replace(/(\.[^.]+)?$/, (e) => `-${n}${e}`);
  used.add(name);
  return name;
}

export async function exportChat(chatId: string, withMedia: boolean, t: Strings) {
  const chat = await core.storage.getChat(chatId);
  if (!chat) return;
  const title = core.chatTitle(chat) || 'PakChat';
  const messages = (await allMessages(chatId)).filter((m) => !(m.expiresAt && m.expiresAt <= Date.now()));
  const paths: string[] = [];
  const names: string[] = [];
  const used = new Set<string>();
  let bytes = 0;
  const lines: string[] = [t.exportHeader];
  for (const m of messages) {
    if (m.kind === 'system') {
      lines.push(`${stamp(m.sentAt)} - ${systemText(m, t)}`);
      continue;
    }
    const who = m.author === core.myId ? core.me?.name || t.youWord : core.name(m.author) || '…';
    let body: string;
    if (m.deleted) body = t.deleted;
    else if (m.file && !m.file.once) {
      const here = m.file.local && new File(m.file.local).exists;
      if (withMedia && here && paths.length < MAX_FILES && bytes + m.file.size <= MAX_BYTES) {
        const name = nameFor(m, used);
        paths.push(m.file.local!);
        names.push(name);
        bytes += m.file.size;
        body = `${name} (${t.fileAttached})${m.text ? `\n${m.text}` : ''}`;
      } else body = `${t.mediaOmitted}${m.text ? `\n${m.text}` : ''}`;
    } else if (m.file?.once) body = t.viewOnceWord;
    else if (m.kind === 'poll' && m.poll)
      body = `${t.poll}: ${m.poll.question}\n${m.poll.options.map((o, i) => `- ${o} (${Object.values(m.votes ?? {}).filter((v) => v.includes(i)).length})`).join('\n')}`;
    else if (m.kind === 'location' && m.location) body = `${m.location.name ?? t.location}: https://www.openstreetmap.org/?mlat=${m.location.lat}&mlon=${m.location.lng}`;
    else body = m.text ?? bodyLine(m, t);
    lines.push(`${stamp(m.sentAt)} - ${who}: ${body}${m.editedAt ? ` ${t.editedWord}` : ''}`);
  }
  const text = lines.join('\n') + '\n';
  const safe = title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
  const textName = `PakChat - ${safe}.txt`;
  let out: File;
  if (withMedia && paths.length) {
    out = new File(Paths.cache, `PakChat - ${safe}.zip`);
    if (out.exists) out.delete();
    await fileModule().zipChat(out.uri, textName, text, paths, names);
  } else {
    out = new File(Paths.cache, textName);
    if (out.exists) out.delete();
    out.create();
    await out.write(text);
  }
  await outsideFor(() => Sharing.shareAsync(out.uri, { mimeType: withMedia && paths.length ? 'application/zip' : 'text/plain', dialogTitle: t.exportChat }));
}
