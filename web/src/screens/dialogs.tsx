// dialogs.tsx: deleting messages, and forwarding them to other chats.

import { MANY_HOPS, type Message, nextHops, UNSEND_HOURS } from '@pakchat/shared';
import { useState } from 'react';

import { core } from '../core/core';
import { type ChatRow, useChatRows } from '../core/hooks';
import { Avatar, photoOf } from '../ui/Avatar';
import { Icon } from '../ui/Icon';
import { closeLayer, Dialog, openLayer, toast } from '../ui/overlay';

const ref = (m: Message) => ({ author: m.author, id: m.id });

/** "Delete message?" with Delete for everyone (mine, within 60 hours, or a group admin's), Delete for me, Cancel. */
export async function deleteMessages(list: Message[]) {
  if (!list.length) return;
  const chat = await core.storage.getChat(list[0].chatId);
  const admin = chat?.kind === 'group' && chat.members.some((m) => m.userId === core.myId && m.role === 'admin');
  const now = Date.now();
  const everyone = list.every((m) => !m.deleted && m.seq !== null && (admin || (m.author === core.myId && now - m.sentAt < UNSEND_HOURS * 3_600_000)));
  const forMe = () => void core.client.deleteHere(list[0].chatId, list.map(ref)).then(() => core.emit(`messages:${list[0].chatId}`));
  const forAll = () =>
    void (async () => {
      for (const m of list) await core.client.deleteForEveryone(m.chatId, ref(m));
    })().catch(() => toast("Couldn't delete. Try again."));
  const id: number = openLayer(
    <Dialog
      title={list.length === 1 ? 'Delete message?' : `Delete ${list.length} messages?`}
      onClose={() => closeLayer(id)}
      buttons={[
        { label: 'Cancel' },
        { label: 'Delete for me', fill: !everyone, red: !everyone, run: forMe },
        ...(everyone ? [{ label: 'Delete for everyone', fill: true, red: true, run: forAll }] : []),
      ]}
    />,
    true,
  );
}

const MAX_FORWARD = 5;

/** Forward to up to 5 chats. Files are fetched, then locked again with a new key for each chat. */
export function forward(list: Message[]) {
  const id: number = openLayer(<ForwardDialog list={list} onClose={() => closeLayer(id)} />, true);
}

function ForwardDialog({ list, onClose }: { list: Message[]; onClose: () => void }) {
  const rows = useChatRows();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  // Forwarded many times: one chat at a time, like WhatsApp.
  const max = list.some((m) => nextHops(m) > MANY_HOPS) ? 1 : MAX_FORWARD;
  const [busy, setBusy] = useState(false);
  const shown = (rows ?? []).filter((r: ChatRow) => !r.chat.left && r.title.toLowerCase().includes(q.trim().toLowerCase()));

  async function send() {
    setBusy(true);
    try {
      for (const chatId of picked) {
        for (const m of list) {
          if (m.file && m.kind === 'file') {
            const blob = await (await fetch(await core.fileUrl(m.file))).blob();
            const file = new File([blob], m.file.name ?? 'file', { type: m.file.mime });
            await core.sendFiles(chatId, [file], m.text || undefined, undefined, nextHops(m));
          } else if (m.kind === 'location' && m.location && !m.location.live) {
            const { updatedAt: _u, ...place } = m.location;
            await core.client.sendLocation(chatId, place, { forwarded: true, hops: nextHops(m) });
          } else if (m.kind === 'contact' && m.contacts) {
            await core.client.sendContacts(chatId, m.contacts, { forwarded: true, hops: nextHops(m) });
          } else if (m.text) {
            await core.client.sendText(chatId, m.text, { forwarded: true, hops: nextHops(m) });
          }
        }
      }
      onClose();
      toast(list.length === 1 ? 'Message forwarded' : 'Messages forwarded');
    } catch {
      setBusy(false);
      toast("Couldn't forward. Check your internet connection.");
    }
  }

  return (
    <div className="dialog pop fwd" role="dialog" aria-modal>
      <div className="fh">
        <button className="ib" onClick={onClose} aria-label="Close">
          <Icon name="close" size={22} />
        </button>
        <h3>Forward message to</h3>
      </div>
      <label className="search">
        <Icon name="search" size={20} />
        <input autoFocus value={q} placeholder="Search name or number" onChange={(e) => setQ(e.target.value)} />
      </label>
      <div className="fl scroll">
        {shown.map((r) => {
          const on = picked.includes(r.chat.id);
          return (
            <button
              key={r.chat.id}
              className="row"
              onClick={() => {
                if (on) setPicked(picked.filter((x) => x !== r.chat.id));
                else if (picked.length >= max) toast(max === 1 ? 'Messages forwarded many times can be sent to only one chat at a time' : `You can only share with up to ${max} chats`);
                else setPicked([...picked, r.chat.id]);
              }}
            >
              <span className={`chk ${on ? '' : 'off'}`}>{on && <Icon name="check" size={13} stroke={3} />}</span>
              <Avatar id={r.other ?? r.chat.id} name={r.title} photo={r.other ? photoOf(r.other) : r.chat.photo} group={r.chat.kind === 'group'} />
              <div className="rt">
                <span className="nm">{r.title}</span>
              </div>
            </button>
          );
        })}
      </div>
      {picked.length > 0 && (
        <div className="fbar">
          <span className="ellip">{(rows ?? []).filter((r) => picked.includes(r.chat.id)).map((r) => r.title).join(', ')}</span>
          <button className="go" disabled={busy} onClick={() => void send()} aria-label="Send">
            <Icon name="send" size={22} />
          </button>
        </div>
      )}
    </div>
  );
}
