// CallsTab.tsx: the Calls tab, like the phone's: calls made and taken on
// this computer, newest first. Click one to call back; ⋮ clears the list.

import type { Chat } from '@pakchat/shared';
import { useEffect, useState } from 'react';

import { callLog, clearCallLog, onCallLog, type CallLogEntry } from '../core/calls';
import { core } from '../core/core';
import { usePeople } from '../core/hooks';
import { Avatar, photoOf } from '../ui/Avatar';
import { chatTitle, listTime } from '../ui/format';
import { Icon } from '../ui/Icon';
import { confirm, openMenu } from '../ui/overlay';
import { startCall } from './Call';
import { tr } from '../i18n';

export function CallsTab() {
  const [log, setLog] = useState<CallLogEntry[] | null>(null);
  const [chats, setChats] = useState<Record<string, Chat>>({});
  usePeople();

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const list = await callLog();
      const byId: Record<string, Chat> = {};
      for (const id of new Set(list.map((e) => e.chatId))) {
        const c = await core.storage.getChat(id);
        if (c) byId[id] = c;
      }
      if (alive) {
        setLog(list);
        setChats(byId);
      }
    };
    void load();
    const off = onCallLog(() => void load());
    return () => {
      alive = false;
      off();
    };
  }, []);

  return (
    <>
      <header className="lh">
        <span className="ptitle">{tr('Calls')}</span>
        <div className="grow" />
        <button
          className="ib"
          aria-label={tr('Menu')}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            openMenu(
              [
                {
                  label: tr('Clear call log'),
                  icon: 'trash',
                  run: async () => {
                    if (await confirm(tr('Clear call log?'), 'This only clears the calls on this computer.', 'Clear', true)) await clearCallLog();
                  },
                },
              ],
              r.right - 200,
              r.bottom + 4,
            );
          }}
        >
          <Icon name="more" size={24} />
        </button>
      </header>
      <div className="rows scroll list">
        {log && log.length === 0 && (
          <div className="none big">
            <Icon name="calls" size={48} stroke={1.4} />
            <p>{tr('Start a voice or video call from a chat with the buttons at the top. Your calls on this computer show here.')}</p>
          </div>
        )}
        {log?.map((e) => {
          const chat = chats[e.chatId];
          const other = !e.group && e.with.length === 1 ? e.with[0] : null;
          const title = e.group && chat ? chatTitle(chat) : other ? core.nameOf(other) : chat ? chatTitle(chat) : '';
          const way = e.missed ? 'Missed' : e.direction === 'in' ? tr('Incoming') : tr('Outgoing');
          return (
            <button key={e.id} className="row callrow" onClick={() => chat && void startCall(chat.id, e.video)} aria-label={`${title}, ${way} ${e.video ? 'video' : 'voice'} call. Call again`}>
              <Avatar id={other ?? e.chatId} name={title} photo={other ? photoOf(other) : chat?.photo} group={e.group} />
              <div className="rt">
                <div className="l1">
                  <span className={`nm ${e.missed ? 'red' : ''}`}>{title}</span>
                  <span className="tm">{listTime(e.at)}</span>
                </div>
                <div className="l2">
                  <span className={`pv sub ${e.missed ? 'missed' : ''}`}>
                    <Icon name={e.direction === 'in' ? 'callIn' : 'callOut'} size={16} />
                    {way}
                    {e.seconds > 0 ? ` · ${Math.floor(e.seconds / 60)}:${String(e.seconds % 60).padStart(2, '0')}` : ''}
                  </span>
                  <span className="kind">
                    <Icon name={e.video ? 'video' : 'calls'} size={20} />
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}
