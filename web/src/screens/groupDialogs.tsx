// groupDialogs.tsx: Group info's own dialogs, like WhatsApp Web: Add members,
// Invite to group via link, and Report.

import type { Chat, ReportReason } from '@pakchat/shared';
import { useEffect, useState } from 'react';

import { core, SERVER } from '../core/core';
import { Avatar, photoOf } from '../ui/Avatar';
import { bodyLine } from '../ui/format';
import { Icon } from '../ui/Icon';
import { closeLayer, confirm, Dialog, openLayer, toast } from '../ui/overlay';
import { usePeopleList } from './NewChat';

const OFFLINE = "Couldn't do that. Check your internet connection.";

/** Add members: my contacts who aren't in the group yet. */
export function addMembers(chat: Chat) {
  const id: number = openLayer(<AddMembers chat={chat} onClose={() => closeLayer(id)} />, true);
}

function AddMembers({ chat, onClose }: { chat: Chat; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const inGroup = new Set(chat.members.map((m) => m.userId));
  const people = usePeopleList(q).filter((p) => !inGroup.has(p.id));

  async function add() {
    setBusy(true);
    try {
      await core.client.addMembers(chat.id, picked);
      onClose();
      toast(picked.length === 1 ? 'Member added' : `${picked.length} members added`);
    } catch {
      setBusy(false);
      toast(OFFLINE);
    }
  }

  return (
    <div className="dialog pop fwd" role="dialog" aria-modal>
      <div className="fh">
        <button className="ib" onClick={onClose} aria-label="Close">
          <Icon name="close" size={22} />
        </button>
        <h3>Add member</h3>
      </div>
      <label className="search">
        <Icon name="search" size={20} />
        <input autoFocus value={q} placeholder="Search name or number" onChange={(e) => setQ(e.target.value)} />
      </label>
      <div className="fl scroll">
        {people.length === 0 && <p className="mnone">No contacts to add</p>}
        {people.map((p) => {
          const on = picked.includes(p.id);
          return (
            <button key={p.id} className="row" onClick={() => setPicked(on ? picked.filter((x) => x !== p.id) : [...picked, p.id])}>
              <span className={`chk ${on ? '' : 'off'}`}>{on && <Icon name="check" size={13} stroke={3} />}</span>
              <Avatar id={p.id} name={p.name} photo={photoOf(p.id)} />
              <div className="rt">
                <span className="nm">{p.name}</span>
                <span className="pv">{p.about}</span>
              </div>
            </button>
          );
        })}
      </div>
      {picked.length > 0 && (
        <div className="fbar">
          <span className="ellip">{people.filter((p) => picked.includes(p.id)).map((p) => p.name).join(', ')}</span>
          <button className="go" disabled={busy} onClick={() => void add()} aria-label="Add">
            <Icon name="check" size={22} />
          </button>
        </div>
      )}
    </div>
  );
}

/** Invite to group via link: the link, Copy link, and Reset link (the old one stops working). */
export function inviteLink(chat: Chat) {
  const id: number = openLayer(<Invite chat={chat} onClose={() => closeLayer(id)} />, true);
}

function Invite({ chat, onClose }: { chat: Chat; onClose: () => void }) {
  const [code, setCode] = useState<string | null>(chat.inviteCode ?? null);
  const [busy, setBusy] = useState(false);
  const link = code ? `${SERVER}/join/${code}` : null;

  async function reset() {
    setBusy(true);
    try {
      setCode((await core.server.resetInvite(chat.id)).code);
    } catch {
      toast(OFFLINE);
    } finally {
      setBusy(false);
    }
  }

  // No link yet: one is made when this opens.
  useEffect(() => {
    if (!chat.inviteCode) void reset();
    // Once, when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Dialog
      title="Invite to group via link"
      onClose={onClose}
      buttons={[
        {
          label: 'Reset link',
          disabled: busy || !link,
          run: () =>
            void confirm('Reset this link?', 'The current link will stop working, and a new one will be made.', 'Reset link', true).then((yes) => {
              if (yes) {
                inviteLink({ ...chat, inviteCode: null });
              } else inviteLink({ ...chat, inviteCode: code });
            }),
        },
        { label: 'Copy link', fill: true, disabled: !link, run: () => void navigator.clipboard.writeText(link!).then(() => toast('Link copied')) },
      ]}
    >
      <p className="vtext">Anyone with PakChat can follow this link to join this group. Only share it with people you trust.</p>
      <p className="ilink">{link ?? <span className="spin" />}</p>
    </Dialog>
  );
}

const REASONS: { value: ReportReason; label: string }[] = [
  { value: 'spam', label: 'Spam' },
  { value: 'scam', label: 'Scam or fraud' },
  { value: 'abuse', label: 'Harassment or abuse' },
  { value: 'other', label: 'Something else' },
];

/**
 * Report a contact or group: the last 5 messages from them (from anyone, in a group)
 * go with it, as on WhatsApp. Then they can be blocked, or the group left.
 */
export function report(chat: Chat, userId: string | null, name: string, after: () => void) {
  const id: number = openLayer(<Report chat={chat} userId={userId} name={name} after={after} onClose={() => closeLayer(id)} />, true);
}

function Report({ chat, userId, name, after, onClose }: { chat: Chat; userId: string | null; name: string; after: () => void; onClose: () => void }) {
  const [reason, setReason] = useState<ReportReason>('spam');
  const [also, setAlso] = useState(true);
  const group = chat.kind === 'group';

  async function send() {
    try {
      const recent = (await core.storage.listMessages(chat.id, { limit: 60 })).filter((m) => m.kind !== 'system' && !m.deleted && m.author !== core.myId && (!userId || m.author === userId)).slice(-5);
      await core.server.report(
        chat.id,
        reason,
        userId,
        recent.map((m) => ({ author: m.author, text: bodyLine(m).slice(0, 2000), at: m.sentAt })),
      );
      toast('Report sent');
      if (also) after();
    } catch {
      toast("Couldn't report. Check your internet connection.");
    }
  }

  return (
    <Dialog title={group ? 'Report this group?' : `Report ${name}?`} onClose={onClose} buttons={[{ label: 'Cancel' }, { label: 'Report', fill: true, red: true, run: () => void send() }]}>
      <p className="vtext">The last 5 messages {group ? 'in this group' : `from ${name}`} will be sent to PakChat. No one in this chat will know.</p>
      {REASONS.map((r) => (
        <button key={r.value} className={`radio ${reason === r.value ? 'on' : ''}`} onClick={() => setReason(r.value)}>
          <i />
          {r.label}
        </button>
      ))}
      <button className="radio also" onClick={() => setAlso(!also)}>
        <span className={`chk ${also ? '' : 'off'}`}>{also && <Icon name="check" size={13} stroke={3} />}</span>
        {group ? 'Also exit the group' : `Also block ${name}`}
      </button>
    </Dialog>
  );
}
