// GroupPicker.tsx: pick some of my groups to put in a community (making one,
// or adding to one). Only groups I'm an admin of, and not in a community yet.
import type { Chat } from '@pakchat/shared';
import { View } from 'react-native';

import { core } from '../core/core';
import { useChatList } from '../core/hooks';
import { fill, useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { Icon } from './icons';
import { Avatar, Divider, Pressy, Txt } from './kit';

/** Groups that can go in a community: mine to run, and in none yet. */
export function canLink(chat: Chat) {
  return chat.kind === 'group' && !chat.left && !chat.communityId && !chat.announcements && !chat.callLink && chat.members.some((m) => m.userId === core.myId && m.role === 'admin');
}

export function GroupPicker({ picked, onToggle }: { picked: string[]; onToggle: (id: string) => void }) {
  const t = useT();
  const { theme } = useLook();
  const rows = (useChatList() ?? []).filter((r) => canLink(r.chat));
  if (!rows.length) {
    return (
      <Txt size={13.5} color={theme.muted} style={{ paddingHorizontal: 22, paddingVertical: 8 }}>
        {t.noGroupsToAdd}
      </Txt>
    );
  }
  return (
    <View>
      {rows.map((r, i) => {
        const on = picked.includes(r.chat.id);
        return (
          <View key={r.chat.id}>
            {i > 0 && <Divider />}
            <Pressy onPress={() => onToggle(r.chat.id)} label={r.title} scale={0.98} testID={`pick-group-${r.title}`}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16, backgroundColor: on ? theme.selected : 'transparent' }}>
                <Avatar id={r.chat.id} name={r.title} size={44} group />
                <View style={{ flex: 1 }}>
                  <Txt size={15.5} weight="600" lines={1}>
                    {r.title}
                  </Txt>
                  <Txt size={12.5} color={theme.muted}>
                    {fill(t.groupMembers, { n: r.chat.members.length })}
                  </Txt>
                </View>
                <View
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    borderWidth: 2,
                    borderColor: on ? theme.acc : theme.faint,
                    backgroundColor: on ? theme.acc : 'transparent',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {on && <Icon name="check" size={14} color="#FFFFFF" stroke={3} />}
                </View>
              </View>
            </Pressy>
          </View>
        );
      })}
    </View>
  );
}
