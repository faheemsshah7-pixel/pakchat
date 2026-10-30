// Communities.tsx: the Communities tab. Each community with its groups;
// click a group to open it. Making communities stays on the phone for now.

import type { Chat } from '@pakchat/shared';

import { core, openChat } from '../core/core';
import { useChatRows, useLoaded, useViewing } from '../core/hooks';
import { Avatar } from '../ui/Avatar';
import { listTime, preview } from '../ui/format';
import { Icon } from '../ui/Icon';

export function Communities() {
  const rows = useChatRows();
  const viewing = useViewing();
  const communities = useLoaded<Chat[]>(['chats'], async () => (await core.storage.listChats()).filter((c) => c.kind === 'community' && !c.left), [], []);

  return (
    <>
      <header className="lh">
        <span className="ptitle">Communities</span>
      </header>
      <div className="rows scroll list">
        {communities.length === 0 && (
          <div className="none big">
            <Icon name="community" size={48} stroke={1.4} />
            <p>Communities bring members together in topic-based groups. Make one in the PakChat app on your phone.</p>
          </div>
        )}
        {communities.map((c) => {
          const groups = (rows ?? []).filter((r) => r.chat.communityId === c.id && !r.chat.left).sort((a, b) => Number(!!b.chat.announcements) - Number(!!a.chat.announcements));
          return (
            <div key={c.id} className="comm">
              <div className="row head">
                <Avatar id={c.id} name={c.title ?? ''} photo={c.photo} group className="sq" />
                <div className="rt">
                  <span className="nm">{c.title}</span>
                </div>
              </div>
              {groups.map((r) => (
                <button key={r.chat.id} className={`row sub ${viewing === r.chat.id ? 'sel' : ''}`} onClick={() => openChat(r.chat.id)}>
                  <Avatar id={r.chat.id} name={r.title} photo={r.chat.photo} group size={40} />
                  <div className="rt">
                    <div className="l1">
                      <span className="nm">{r.chat.announcements ? 'Announcements' : r.title}</span>
                      <span className="tm">{r.last ? listTime(r.last.sentAt) : ''}</span>
                    </div>
                    <div className="l2">
                      <span className="pv">{preview(r.last, true)}</span>
                      {r.chat.unread > 0 && <span className="badge">{r.chat.unread}</span>}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}
