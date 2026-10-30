// Starred.tsx: "Starred messages" from the chat list's menu. Click one to go to it in its chat.

import type { Message } from '@pakchat/shared';

import { core, openChat } from '../core/core';
import { useLoaded } from '../core/hooks';
import { bodyLine, chatTitle, clock, dayLabel, memberName } from '../ui/format';
import { Icon } from '../ui/Icon';
import { msgKey, setView } from '../ui/view';
import { tr } from '../i18n';

export function Starred() {
  const list = useLoaded<{ m: Message; chat: string }[] | null>(
    ['prefs', 'chats'],
    async () => {
      const out: { m: Message; chat: string }[] = [];
      for (const k of Object.keys(core.starred)) {
        const [chatId, author, id] = k.split('/');
        const m = await core.storage.getMessage(chatId, author, id);
        const chat = await core.storage.getChat(chatId);
        // "Sara › You" in a chat with Sara, "You › Sara", or "Sara › FAST CS-B" in a group.
        if (m && chat && !m.deleted) out.push({ m, chat: chat.kind === 'group' || m.author === core.myId ? chatTitle(chat) : 'You' });
      }
      return out.sort((a, b) => b.m.sentAt - a.m.sentAt);
    },
    [],
    null,
  );
  return (
    <>
      <header className="sh slide">
        <button className="ib" onClick={() => setView({ side: null })} aria-label={tr('Back')}>
          <Icon name="back" size={22} />
        </button>
        <span>{tr('Starred messages')}</span>
      </header>
      <div className="rows scroll list starred">
        {list?.length === 0 && (
          <div className="none big">
            <Icon name="star" size={48} stroke={1.4} />
            <p>{tr('Click a message\'s menu and choose Star to find it here later.')}</p>
          </div>
        )}
        {list?.map(({ m, chat }) => (
          <button
            key={msgKey(m)}
            className="srow2"
            onClick={() => {
              openChat(m.chatId);
              setView({ jumpTo: msgKey(m) });
            }}
          >
            <div className="sl">
              <b>{memberName(m.author)}</b> › {chat}
              <span>{dayLabel(m.sentAt)}</span>
            </div>
            <div className={`bub ${m.author === core.myId ? 'out' : 'in'}`}>
              <span>{bodyLine(m)}</span>
              <span className="meta">
                <Icon name="starFilled" size={12} /> {clock(m.sentAt)}
              </span>
            </div>
          </button>
        ))}
      </div>
    </>
  );
}
