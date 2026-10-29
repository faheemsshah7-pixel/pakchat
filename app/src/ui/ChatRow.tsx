// ChatRow.tsx: one chat in the list. Swiping sideways moves between the tabs,
// like WhatsApp, so pin and archive are in the hold menu (not a swipe on the row).
//
// A row only redraws when its own chat changes (or its typing, online or
// picked): a new message in one chat doesn't redraw every row in the list.
import { memo, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { core } from '../core/core';
import { plainText } from '../core/richText';
import type { ChatRow as Row } from '../core/hooks';
import { fill, useT } from '../i18n';
import { useTheme } from '../theme/ThemeProvider';
import { listTime, preview } from './format';
import { Icon } from './icons';
import { Avatar, Pressy, Txt } from './kit';
import { fadeIn, fadeOut, popIn, popOut } from './motion';

type Props = {
  row: Row;
  typing: string[];
  online: boolean;
  selecting: boolean;
  selected: boolean;
  /** The handlers get the row. Hand in ones that stay the same (useStable), so rows needn't redraw for them. */
  onPress: (row: Row) => void;
  onLongPress: (row: Row) => void;
  /** Tapping the picture (not while picking): it pops up bigger, like WhatsApp. */
  onAvatar?: (row: Row) => void;
};

export const ChatRow = memo(
  ChatRowView,
  (a: Props, b: Props) =>
    a.row === b.row &&
    a.online === b.online &&
    a.selecting === b.selecting &&
    a.selected === b.selected &&
    a.onPress === b.onPress &&
    a.onLongPress === b.onLongPress &&
    a.onAvatar === b.onAvatar &&
    a.typing.join() === b.typing.join(),
);

function ChatRowView({
  row,
  typing,
  online,
  selecting,
  selected,
  onPress,
  onLongPress,
  onAvatar,
}: Props) {
  const t = useT();
  const theme = useTheme();
  const { chat, last, prefs, title } = row;

  // What the second line says: someone typing, a draft, or the newest message.
  const line = useMemo(() => {
    if (typing.length) {
      return {
        text: chat.kind === 'group' ? fill(t.nameTyping, { name: core.name(typing[0]) || '…' }) : t.typing,
        color: theme.acc,
        weight: '600' as const,
      };
    }
    const unread = chat.unread > 0;
    // A chat locked in the list never shows its words: only whether something new came.
    // (Inside the unlocked Locked chats folder they show, like WhatsApp.)
    if (prefs.lock === 'list') return { text: unread ? t.newMessage : t.lockedChat, color: unread ? theme.text : theme.muted, weight: unread ? ('600' as const) : ('400' as const) };
    // "Draft:" in green, then the words, like WhatsApp.
    if (prefs.draft) return { label: t.draft, text: plainText(prefs.draft).replace(/\s+/g, ' '), color: theme.muted, weight: '400' as const };
    return { text: preview(last, t, chat.kind === 'group'), color: unread ? theme.text : theme.muted, weight: unread ? ('600' as const) : ('400' as const) };
  }, [typing, prefs.draft, prefs.lock, last, chat, t, theme]);

  const unread = chat.unread || (prefs.markedUnread ? 1 : 0);
  const mine = last && last.kind !== 'system' && !last.deleted && last.author === core.myId && !typing.length && !prefs.draft && prefs.lock !== 'list';
  const when = Math.max(chat.lastActivity, last?.sentAt ?? 0);

  return (
    <View style={{ borderRadius: 18, overflow: 'hidden' }}>
          <Pressy onPress={() => onPress(row)} onLongPress={() => onLongPress(row)} scale={0.985} label={title} testID={`chat-${title}`}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 13,
                paddingHorizontal: 14,
                height: 72,
                borderRadius: 18,
                backgroundColor: theme.dark ? theme.bg : '#FFFFFF',
              }}
            >
              {/* Picked: the row tints and a tick pops onto the photo, like WhatsApp's. */}
              {selected && <Animated.View entering={fadeIn} exiting={fadeOut} style={[StyleSheet.absoluteFill, { borderRadius: 18, backgroundColor: theme.selected }]} />}
              <View>
                <Pressy onPress={onAvatar && (() => onAvatar(row))} disabled={!onAvatar || selecting} label={t.profilePhoto} scale={0.92} testID={`avatar-${title}`}>
                  <Avatar id={chat.id} name={title} size={50} online={online} group={chat.kind === 'group'} />
                </Pressy>
                {selected && (
                  <Animated.View
                    entering={popIn}
                    exiting={popOut}
                    style={{
                      position: 'absolute',
                      end: -3,
                      bottom: -3,
                      width: 22,
                      height: 22,
                      borderRadius: 11,
                      backgroundColor: theme.acc,
                      borderWidth: 2,
                      borderColor: theme.dark ? theme.bg : '#FFFFFF',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon name="check" size={13} color="#FFFFFF" stroke={3} />
                  </Animated.View>
                )}
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Txt size={16} weight="600" lines={1}>
                      {title}
                    </Txt>
                  </View>
                  {!!when && (
                    <Txt size={12} weight="600" color={unread ? theme.acc : theme.muted}>
                      {listTime(when, t)}
                    </Txt>
                  )}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  {mine && <Ticks status={last.status} size={16} />}
                  <View style={{ flex: 1 }}>
                    <Txt size={14} lines={1} color={line.color} weight={line.weight}>
                      {'label' in line && (
                        <Text style={{ color: theme.online, fontWeight: '600' }} testID="draft-label">
                          {`${line.label} `}
                        </Text>
                      )}
                      {line.text}
                    </Txt>
                  </View>
                  {prefs.lock === 'list' && <Icon name="lock" size={15} color={theme.muted} />}
                  {prefs.muted && <Icon name="muted" size={15} color={theme.muted} />}
                  {!!prefs.pinnedAt && <Icon name="pin" size={15} color={theme.muted} />}
                  {row.mentioned && unread > 0 && prefs.lock !== 'list' && (
                    <View style={{ width: 21, height: 21, borderRadius: 11, backgroundColor: theme.acc, alignItems: 'center', justifyContent: 'center' }} testID="row-mention">
                      <Txt size={12} weight="800" color="#FFFFFF" align="center">
                        @
                      </Txt>
                    </View>
                  )}
                  {unread > 0 && (
                    <View
                      style={{
                        minWidth: 21,
                        height: 21,
                        paddingHorizontal: 6,
                        borderRadius: 11,
                        backgroundColor: prefs.muted ? theme.faint : theme.acc,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Txt size={11} weight="700" color="#FFFFFF" align="center">
                        {chat.unread ? String(chat.unread) : ''}
                      </Txt>
                    </View>
                  )}
                </View>
              </View>
            </View>
          </Pressy>
    </View>
  );
}

/** The ticks on my own messages: a clock while waiting, one tick sent, two delivered, two in colour read. */
export function Ticks({ status, size = 15, color }: { status?: string; size?: number; color?: string }) {
  const theme = useTheme();
  if (status === 'queued' || status === 'paused') return <Icon name="clock" size={size - 2} color={color ?? theme.muted} />;
  if (status === 'failed') return <Icon name="warning" size={size - 1} color={theme.danger} />;
  if (status === 'sent') return <Icon name="tick" size={size} color={color ?? theme.muted} stroke={2.2} />;
  return <Icon name="ticks" size={size} color={status === 'read' ? theme.read : (color ?? theme.muted)} stroke={2.2} />;
}
