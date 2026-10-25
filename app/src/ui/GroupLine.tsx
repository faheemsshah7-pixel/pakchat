// GroupLine.tsx: one group in a community (its card on the Communities tab,
// and the community's own page): picture, name, latest message and time.
// The announcements group shows a megaphone and its own name.
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import type { ChatRow } from '../core/hooks';
import { useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { listTime, preview } from './format';
import { Icon } from './icons';
import { Avatar, Pressy, Txt } from './kit';

/** One group in a community's card: its picture, name, latest message and time. */
export function GroupLine({ row, right, onLongPress }: { row: ChatRow; right?: ReactNode; onLongPress?: () => void }) {
  const t = useT();
  const { theme } = useLook();
  const { chat, last, title } = row;
  const unread = chat.unread > 0 || !!row.prefs.markedUnread;
  return (
    <Pressy
      onPress={() => router.push({ pathname: '/chat/[id]', params: { id: chat.id } })}
      onLongPress={onLongPress}
      label={title}
      scale={0.98}
      testID={chat.announcements ? 'community-announcements' : 'community-group'}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10 }}>
        {chat.announcements ? (
          <View style={{ width: 40, height: 40, borderRadius: 14, backgroundColor: theme.accSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="broadcast" size={20} color={theme.accInk} />
          </View>
        ) : (
          <Avatar id={chat.id} name={title} size={40} group />
        )}
        <View style={{ flex: 1, gap: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Txt size={15} weight="700" lines={1} style={{ flex: 1 }}>
              {chat.announcements ? t.announcements : title}
            </Txt>
            {!!last && (
              <Txt size={11.5} color={unread ? theme.accInk : theme.muted}>
                {listTime(last.sentAt, t)}
              </Txt>
            )}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Txt size={13} color={unread ? theme.text : theme.muted} weight={unread ? '600' : '400'} lines={1} style={{ flex: 1 }}>
              {last ? preview(last, t, true) : chat.announcements ? t.announcementsSub : ''}
            </Txt>
            {chat.unread > 0 && (
              <View style={{ minWidth: 19, height: 19, borderRadius: 10, paddingHorizontal: 5, backgroundColor: theme.acc, alignItems: 'center', justifyContent: 'center' }}>
                <Txt size={11} weight="700" color="#FFFFFF">
                  {chat.unread}
                </Txt>
              </View>
            )}
          </View>
        </View>
        {right}
      </View>
    </Pressy>
  );
}
