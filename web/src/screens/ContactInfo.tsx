// ContactInfo.tsx: the right-hand drawer: Contact info (or Group info), and
// Verify security code.

import { MAX_CALL_PEOPLE, type Chat, type Message } from '@pakchat/shared';
import { useEffect, useRef, useState } from 'react';

import { core, openChat } from '../core/core';
import { useChat, useLoaded, usePrefs, usePresence, useTopic } from '../core/hooks';
import { Avatar, photoOf } from '../ui/Avatar';
import { bodyLine, chatTitle, clock, groupName, isSelfChat, lastSeen, memberName, otherPerson, phoneOf } from '../ui/format';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/icons';
import { askText, confirm, openMenu, toast, type MenuItem } from '../ui/overlay';
import { Ticks } from '../ui/Ticks';
import { setView, useView } from '../ui/view';
import { block, deleteChat, disappearing, favourite, isMuted, mute, TIMERS } from './chatActions';
import { addMembers, inviteLink, report } from './groupDialogs';
import { startCall } from './Call';
import { cropPhoto, viewPhoto } from './Profile';
import { tr } from '../i18n';

const OFFLINE = "Couldn't do that. Check your internet connection.";
/** Does it, and says so if it couldn't. */
const act = (work: Promise<unknown>) => void work.catch(() => toast(OFFLINE));

const timerLabel = (s?: number) => TIMERS.find((t) => Number(t.value) === (s ?? 0))?.label ?? 'On';

function Row({ icon, title, sub, red, right, onClick }: { icon?: IconName; title: string; sub?: string; red?: boolean; right?: React.ReactNode; onClick?: () => void }) {
  return (
    <button className={`drow ${red ? 'red' : ''}`} onClick={onClick} disabled={!onClick}>
      {icon && <Icon name={icon} size={22} />}
      <span className="dt">
        {title}
        {sub && <small>{sub}</small>}
      </span>
      {right}
    </button>
  );
}

export function ContactInfo({ chatId }: { chatId: string }) {
  const chat = useChat(chatId);
  const prefs = usePrefs();
  const photoFile = useRef<HTMLInputElement>(null);
  useTopic(['people', 'photos', 'blocked'], () => `${core.photosVersion}/${Object.keys(core.people).length}/${core.blocked?.size ?? -1}`);
  const other = chat ? otherPerson(chat) : null;
  const presence = usePresence(other);
  const media = useLoaded<Message[]>(
    [`messages:${chatId}`],
    async () => (await core.storage.listMessages(chatId, { limit: 100_000 })).filter((m) => !m.deleted && m.kind === 'file' && !!m.file && !m.file.once && m.file.kind !== 'voice'),
    [chatId],
    [],
  );
  const common = useLoaded<Chat[]>(['chats'], async () => (other ? (await core.storage.listChats()).filter((c) => c.kind === 'group' && !c.left && c.members.some((m) => m.userId === other)) : []), [other], []);

  useEffect(() => {
    if (!core.blocked) void core.loadBlocked().catch(() => {});
  }, []);

  if (!chat) return null;
  const group = chat.kind === 'group';
  const self = isSelfChat(chat);
  const title = chatTitle(chat);
  const p = prefs[chat.id] ?? {};
  const amAdmin = chat.members.some((m) => m.userId === core.myId && m.role === 'admin');
  const blocked = !!other && !!core.blocked?.has(other);
  const close = () => setView({ drawer: null });
  // Like WhatsApp: admins, or everyone when "Edit group settings" is open to members.
  const ann = !!chat.announcements;
  const canEdit = group && !ann && !chat.left && (amAdmin || !!chat.membersEdit);
  const canAdd = group && !ann && !chat.left && (amAdmin || !!chat.membersAdd);

  const rename = async () => {
    const name = await askText('Group name', 'Group name', 'Save', 100, { initial: chat.title ?? '' });
    if (name && name !== chat.title) act(core.client.updateGroup(chat.id, { title: name }));
  };
  const describe = async () => {
    const text = await askText('Group description', 'Add group description', 'Save', 2048, { initial: chat.description ?? '', long: true });
    if (text != null && text !== (chat.description ?? '')) act(core.client.updateGroup(chat.id, { description: text }));
  };
  const photoMenu = (x: number, y: number) => {
    const items: MenuItem[] = [];
    if (chat.photo) items.push({ label: tr('View photo'), icon: 'eye', run: () => viewPhoto(core.photoUrl(chat.photo), title) });
    items.push({ label: tr('Upload photo'), icon: 'upload', run: () => photoFile.current?.click() });
    if (chat.photo)
      items.push({
        label: tr('Remove photo'),
        icon: 'trash',
        run: () => void confirm(tr('Remove group photo?'), '', 'Remove', true).then((yes) => yes && act(core.client.updateGroup(chat.id, { photo: '' }))),
      });
    openMenu(items, x, y);
  };
  const memberMenu = (userId: string, x: number, y: number) => {
    const admin = chat.members.some((m) => m.userId === userId && m.role === 'admin');
    const name = memberName(userId);
    openMenu(
      [
        { label: `Message ${name}`, icon: 'chat', run: () => void core.client.openDirect(userId).then((c) => openChat(c.id)) },
        { label: admin ? tr('Dismiss as admin') : tr('Make group admin'), icon: 'shield', run: () => act(core.client.setAdmin(chat.id, userId, !admin)) },
        {
          label: `Remove ${name}`,
          icon: 'leave',
          run: () => void confirm(`Remove ${name} from "${title}" group?`, '', 'Remove', true).then((yes) => yes && act(core.client.removeMember(chat.id, userId))),
        },
      ],
      x,
      y,
    );
  };

  const setTimer = () => disappearing(chat);

  return (
    <>
      <div className="dh">
        <button className="ib" onClick={close} aria-label={tr('Close')}>
          <Icon name="close" size={22} />
        </button>
        {group ? tr('Group info') : tr('Contact info')}
      </div>
      <div className="db scroll">
        <div className="who blk">
          <Avatar
            id={other ?? chat.id}
            name={title}
            photo={other ? photoOf(other) : chat.photo}
            group={group}
            onClick={(e) => (canEdit ? photoMenu(e.clientX, e.clientY) : viewPhoto(core.photoUrl(other ? photoOf(other) : chat.photo), title))}
          />
          {canEdit && (
            <input
              ref={photoFile}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                void cropPhoto(f).then((square) => {
                  if (!square) return;
                  toast(tr('Uploading photo…'));
                  act(core.uploadPhoto(square, chat.id).then((photo) => core.client.updateGroup(chat.id, { photo })).then(() => toast(tr('Group photo updated'))));
                });
              }}
            />
          )}
          <h2 className="ename">
            {title}
            {canEdit && (
              <button className="ib" onClick={() => void rename()} aria-label={tr('Edit group name')} data-tip={tr('Edit')}>
                <Icon name="edit" size={18} />
              </button>
            )}
          </h2>
          <p>{group ? `Group · ${chat.members.length} members` : self ? 'Message yourself' : phoneOf(other!) || lastSeen(presence)}</p>
          {!group && !self && core.contacts[other!] == null && core.people[other!]?.name && <p className="sm">~{core.people[other!]!.name}</p>}
          <div className="acts">
            {!self && !chat.left && !chat.callLink && (!group || chat.members.length <= MAX_CALL_PEOPLE) && (
              <>
                <button onClick={() => void startCall(chat.id, false)}>
                  <Icon name="calls" size={22} />
                  {tr('Voice')}
                </button>
                <button onClick={() => void startCall(chat.id, true)}>
                  <Icon name="video" size={22} />
                  {tr('Video')}
                </button>
              </>
            )}
            <button onClick={() => setView({ drawer: 'search' })}>
              <Icon name="search" size={22} />
              {tr('Search')}
            </button>
          </div>
        </div>

        {(group ? chat.description || canEdit : core.people[other!]?.about) && (
          <div className="blk">
            <div className="lab l1">
              <span style={{ flex: 1 }}>{group ? tr('Description') : tr('About')}</span>
              {canEdit && (
                <button className="ib" onClick={() => void describe()} aria-label={tr('Edit group description')} data-tip={tr('Edit')}>
                  <Icon name="edit" size={18} />
                </button>
              )}
            </div>
            {group && !chat.description ? (
              <button className="addesc" onClick={() => void describe()}>
                {tr('Add group description')}
              </button>
            ) : (
              <div className="pre">{group ? chat.description : core.people[other!]?.about}</div>
            )}
          </div>
        )}

        <div className="blk mlink" role="button" tabIndex={0} onClick={() => setView({ drawer: 'media' })} onKeyDown={(e) => e.key === 'Enter' && setView({ drawer: 'media' })}>
          <div className="l1">
            <span className="lab" style={{ flex: 1, margin: 0 }}>
              {tr('Media, links and docs')}
            </span>
            <span className="lab" style={{ margin: 0 }}>
              {media.length}
            </span>
            <Icon name="forwardArrow" size={18} />
          </div>
          {media.length > 0 && (
            <div className="thumbs">
              {media
                .filter((m) => m.file!.thumb)
                .slice(-4)
                .reverse()
                .map((m) => (
                  <img key={m.id} src={`data:image/jpeg;base64,${m.file!.thumb}`} alt="" />
                ))}
            </div>
          )}
        </div>

        <div className="blk" style={{ padding: '4px 0' }}>
          <Row icon="star" title={tr('Starred messages')} right={<Icon name="forwardArrow" size={18} />} onClick={() => setView({ tab: 'chats', side: 'starred' })} />
          <Row icon="bell" title={tr('Mute notifications')} right={<span className={`sw ${isMuted(p) ? 'on' : ''}`} />} onClick={() => void mute(chat)} />
          {(!group || amAdmin || !chat.onlyAdminsSend) && <Row icon="timer" title={tr('Disappearing messages')} sub={timerLabel(chat.timer)} right={<Icon name="forwardArrow" size={18} />} onClick={() => void setTimer()} />}
          {!self && !group && <Row icon="lock" title={tr('Encryption')} sub={tr('Messages are end-to-end encrypted. Click to verify.')} onClick={() => setView({ drawer: 'verify' })} />}
          {group && <Row icon="lock" title={tr('Encryption')} sub={tr('Messages are end-to-end encrypted.')} />}
        </div>

        {group && amAdmin && !ann && !chat.left && (
          <div className="blk" style={{ padding: '4px 0' }}>
            <div className="lab" style={{ padding: '10px 24px 4px' }}>
              {tr('Group permissions')}
            </div>
            <Row title={tr('Edit group settings')} sub={tr('Members can change the group\'s name, photo and description')} right={<span className={`sw ${chat.membersEdit ? 'on' : ''}`} />} onClick={() => act(core.client.updateGroup(chat.id, { membersEdit: !chat.membersEdit }))} />
            <Row title={tr('Send messages')} sub={chat.onlyAdminsSend ? tr('Only admins') : tr('All members')} right={<span className={`sw ${chat.onlyAdminsSend ? '' : 'on'}`} />} onClick={() => act(core.client.updateGroup(chat.id, { onlyAdminsSend: !chat.onlyAdminsSend }))} />
            <Row title={tr('Add other members')} sub={tr('Members can add people to the group')} right={<span className={`sw ${chat.membersAdd ? 'on' : ''}`} />} onClick={() => act(core.client.updateGroup(chat.id, { membersAdd: !chat.membersAdd }))} />
            <Row title={tr('Approve new members')} sub={tr('Admins approve who joins with the invite link')} right={<span className={`sw ${chat.joinApproval ? 'on' : ''}`} />} onClick={() => act(core.client.updateGroup(chat.id, { joinApproval: !chat.joinApproval }))} />
          </div>
        )}

        {group && (
          <div className="blk" style={{ padding: '4px 0' }}>
            <div className="lab" style={{ padding: '10px 24px 4px' }}>
              {chat.members.length} members
            </div>
            {canAdd && <Row icon="userPlus" title={tr('Add member')} onClick={() => addMembers(chat)} />}
            {amAdmin && !ann && !chat.left && <Row icon="link" title={tr('Invite to group via link')} onClick={() => inviteLink(chat)} />}
            {[...chat.members]
              .sort((a, b) => (a.userId === core.myId ? -1 : b.userId === core.myId ? 1 : memberName(a.userId).localeCompare(memberName(b.userId))))
              .map((m) => (
                <button
                  key={m.userId}
                  className="drow mem"
                  onClick={(e) => {
                    if (m.userId === core.myId) return;
                    // Admins get a menu (Message, Make group admin, Remove), like WhatsApp Web.
                    if (amAdmin && !ann && !chat.left) memberMenu(m.userId, e.clientX, e.clientY);
                    else void core.client.openDirect(m.userId).then((c) => openChat(c.id));
                  }}
                >
                  <Avatar id={m.userId} name={memberName(m.userId)} photo={photoOf(m.userId)} size={40} />
                  <span className="dt">
                    {m.userId === core.myId ? 'You' : groupName(m.userId)}
                    <small>{core.people[m.userId]?.about ?? ''}</small>
                  </span>
                  {m.role === 'admin' && <span className="admin">{tr('Group admin')}</span>}
                </button>
              ))}
          </div>
        )}

        {!group && !self && common.length > 0 && (
          <div className="blk" style={{ padding: '4px 0' }}>
            <div className="lab" style={{ padding: '10px 24px 4px' }}>
              {common.length === 1 ? '1 group in common' : `${common.length} groups in common`}
            </div>
            {common.map((c) => (
              <button key={c.id} className="drow mem" onClick={() => openChat(c.id)}>
                <Avatar id={c.id} name={c.title ?? ''} photo={c.photo} group size={40} />
                <span className="dt">{c.title}</span>
              </button>
            ))}
          </div>
        )}

        <div className="blk" style={{ padding: '4px 0', border: 0 }}>
          <Row icon="heart" title={p.favourite ? tr('Remove from Favourites') : tr('Add to Favourites')} onClick={() => void favourite(chat)} />
          {!group && !self && <Row icon="block" title={`${blocked ? tr('Unblock') : tr('Block')} ${title}`} red onClick={() => void block(chat)} />}
          {!self && (
            <Row
              icon="flag"
              title={group ? 'Report group' : `Report ${title}`}
              red
              onClick={() => report(chat, group ? null : other, title, () => void (group ? deleteChat(chat) : !blocked && block(chat)))}
            />
          )}
          {group && !chat.left ? <Row icon="leave" title={tr('Exit group')} red onClick={() => void deleteChat(chat)} /> : <Row icon="trash" title={tr('Delete chat')} red onClick={() => void deleteChat(chat)} />}
        </div>
      </div>
    </>
  );
}

/** Verify security code: the 60 digits both phones work out from your two keys. */
export function Verify({ chatId }: { chatId: string }) {
  const chat = useChat(chatId);
  const other = chat ? otherPerson(chat) : null;
  const [code, setCode] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!other) return;
    core.client
      .safetyNumber(other)
      .then(setCode)
      .catch(() => setFailed(true));
  }, [other]);
  if (!chat || !other) return null;
  const name = chatTitle(chat);
  const groups = code?.match(/.{1,5}/g) ?? [];
  return (
    <>
      <div className="dh">
        <button className="ib" onClick={() => setView({ drawer: 'info' })} aria-label={tr('Back')}>
          <Icon name="back" size={22} />
        </button>
        {tr('Verify security code')}
      </div>
      <div className="db verify">
        <div className="vshield">
          <Icon name="shield" size={44} stroke={1.6} />
        </div>
        {code ? (
          <div className="code">
            {groups.map((g, i) => (
              <span key={i}>{g}</span>
            ))}
          </div>
        ) : failed ? (
          <p className="vtext">{tr('Couldn\'t work out the code. Check your internet connection and try again.')}</p>
        ) : (
          <div className="code">
            <span className="spin" />
          </div>
        )}
        <p className="vtext">
          {tr('To check that your messages with')}{' '}{name}{' '}{tr('are end-to-end encrypted, compare these 60 numbers with the ones on')}{' '}{name}{tr('\'s phone (their chat with you › Encryption). If they match, nobody is in the middle.')}
        </p>
        <div className="vnote">
          <Icon name="shield" size={20} />
          <div>
            <b>{tr('The code changes when either of you reinstalls PakChat.')}</b>
            {tr('You\'ll see a note in the chat when that happens.')}
          </div>
        </div>
      </div>
    </>
  );
}

/** "Message info" for one of my messages: who has it and who has read it. */
export function MessageInfo({ chatId }: { chatId: string }) {
  const view = useView();
  const chat = useChat(chatId);
  const start = view.info?.chatId === chatId ? view.info : null;
  // Live: the ticks change while the drawer is open.
  const m = useLoaded<Message | null>([`messages:${chatId}`], async () => (start ? core.storage.getMessage(chatId, start.author, start.id) : null), [chatId, start?.id], start);
  if (!chat || !m) return null;
  const close = () => setView({ drawer: null, info: null });
  const others = chat.members.filter((x) => x.userId !== core.myId).map((x) => x.userId);
  const readBy = chat.kind === 'group' ? (m.readBy ?? []).filter((id) => others.includes(id)) : m.status === 'read' ? others : [];
  const gotIt = chat.kind === 'group' ? (m.deliveredTo ?? []).filter((id) => others.includes(id) && !readBy.includes(id)) : m.status === 'delivered' ? others : [];
  const waiting = others.filter((id) => !readBy.includes(id) && !gotIt.includes(id));
  const people = (title: string, icon: React.ReactNode, ids: string[]) => (
    <div className="blk misec">
      <div className="lab">
        {icon}
        {title}
      </div>
      {ids.length === 0 ? (
        <p className="mnone">{chat.kind === 'group' ? tr('No one yet') : tr('Not yet')}</p>
      ) : (
        ids.map((id) => (
          <div key={id} className="drow mem">
            <Avatar id={id} name={memberName(id)} photo={photoOf(id)} size={40} />
            <span className="dt">{chat.kind === 'group' ? groupName(id) : memberName(id)}</span>
          </div>
        ))
      )}
    </div>
  );
  return (
    <>
      <div className="dh">
        <button className="ib" onClick={close} aria-label={tr('Close')}>
          <Icon name="close" size={22} />
        </button>
        {tr('Message info')}
      </div>
      <div className="db">
        <div className="mipv">
          <div className="bub out">
            <span>{bodyLine(m)}</span>
            <span className="meta">
              {clock(m.sentAt)} <Ticks status={m.status} />
            </span>
          </div>
        </div>
        {people('Read', <Ticks status="read" />, readBy)}
        {people('Delivered', <Ticks status="delivered" />, gotIt)}
        {chat.kind === 'group' && waiting.length > 0 && people('Sent', <Ticks status="sent" />, waiting)}
      </div>
    </>
  );
}
