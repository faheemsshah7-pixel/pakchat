// ChatRow.tsx: one chat in the list, and the swipes on it.
//
// Swipe right to pin (or unpin), left to archive. The icon underneath grows as
// you pull, you feel a tick when you've pulled far enough, and the row springs
// back when you let go. Your finger's speed carries into the spring.
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { core } from '../core/core';
import type { ChatRow as Row } from '../core/hooks';
import { fill, useT } from '../i18n';
import { useTheme } from '../theme/ThemeProvider';
import { listTime, preview } from './format';
import { Icon } from './icons';
import { Avatar, Pressy, Txt } from './kit';
import { fade, smooth, tick } from './motion';

const PULL = 76;

export function ChatRow({
  row,
  typing,
  online,
  selecting,
  selected,
  onPress,
  onLongPress,
  onPin,
  onArchive,
}: {
  row: Row;
  typing: string[];
  online: boolean;
  selecting: boolean;
  selected: boolean;
  onPress: () => void;
  onLongPress: () => void;
  onPin: () => void;
  onArchive: () => void;
}) {
  const t = useT();
  const theme = useTheme();
  const { chat, last, prefs, title } = row;
  const x = useSharedValue(0);
  const over = useSharedValue(0);

  const pan = usePanGesture({
    enabled: !selecting,
    activeOffsetX: [-14, 14],
    failOffsetY: [-10, 10],
    onUpdate: (e) => {
      'worklet';
      x.value = e.translationX;
      const now = Math.abs(e.translationX) > PULL ? 1 : 0;
      if (now !== over.value) {
        over.value = now;
        scheduleOnRN(tick);
      }
    },
    onDeactivate: (e) => {
      'worklet';
      if (e.translationX > PULL) scheduleOnRN(onPin);
      else if (e.translationX < -PULL) scheduleOnRN(onArchive);
      over.value = 0;
      x.value = withSpring(0, { ...smooth, velocity: e.velocityX });
    },
  });

  const front = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const pinSide = useAnimatedStyle(() => ({
    opacity: interpolate(x.value, [0, 24], [0, 1], 'clamp'),
    transform: [{ scale: interpolate(x.value, [0, PULL], [0.6, 1.08], 'clamp') }],
  }));
  const archiveSide = useAnimatedStyle(() => ({
    opacity: interpolate(x.value, [-24, 0], [1, 0], 'clamp'),
    transform: [{ scale: interpolate(x.value, [-PULL, 0], [1.08, 0.6], 'clamp') }],
  }));
  const pickedStyle = useAnimatedStyle(() => ({ opacity: withTiming(selected ? 1 : 0, fade) }), [selected]);

  // What the second line says: someone typing, a draft, or the newest message.
  const line = useMemo(() => {
    if (typing.length) {
      return {
        text: chat.kind === 'group' ? fill(t.nameTyping, { name: core.name(typing[0]) || '…' }) : t.typing,
        color: theme.acc,
        weight: '600' as const,
      };
    }
    if (prefs.draft) return { text: `${t.draft} ${prefs.draft}`, color: theme.danger, weight: '400' as const };
    const unread = chat.unread > 0;
    return { text: preview(last, t, chat.kind === 'group'), color: unread ? theme.text : theme.muted, weight: unread ? ('600' as const) : ('400' as const) };
  }, [typing, prefs.draft, last, chat, t, theme]);

  const unread = chat.unread || (prefs.markedUnread ? 1 : 0);
  const mine = last && last.kind !== 'system' && !last.deleted && last.author === core.myId && !typing.length && !prefs.draft;
  const when = Math.max(chat.lastActivity, last?.sentAt ?? 0);

  return (
    <View style={{ borderRadius: 18, overflow: 'hidden' }}>
      {/* Underneath: pin on the left, archive on the right (the same in Urdu, as the hint says). */}
      <View style={[StyleSheet.absoluteFill, { flexDirection: 'row', direction: 'ltr', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22 }]}>
        <Animated.View style={[{ alignItems: 'center', gap: 2 }, pinSide]}>
          <Icon name="pin" size={22} color={theme.accInk} />
          <Txt size={11} weight="600" color={theme.accInk}>
            {prefs.pinnedAt ? t.unpin : t.pin}
          </Txt>
        </Animated.View>
        <Animated.View style={[{ alignItems: 'center', gap: 2 }, archiveSide]}>
          <Icon name="archive" size={22} color={theme.accInk} />
          <Txt size={11} weight="600" color={theme.accInk}>
            {prefs.archived ? t.unarchive : t.archive}
          </Txt>
        </Animated.View>
      </View>
      <GestureDetector gesture={pan}>
        <Animated.View style={front}>
          <Pressy onPress={onPress} onLongPress={onLongPress} scale={0.985} label={title} testID={`chat-${title}`}>
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
              <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: 18, backgroundColor: theme.selected }, pickedStyle]} />
              <View>
                <Avatar id={chat.id} name={title} size={50} online={online} group={chat.kind === 'group'} />
                {selected && (
                  <View
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
                  </View>
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
                      {line.text}
                    </Txt>
                  </View>
                  {prefs.muted && <Icon name="muted" size={15} color={theme.muted} />}
                  {!!prefs.pinnedAt && <Icon name="pin" size={15} color={theme.muted} />}
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
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

/** The ticks on my own messages: a clock while waiting, one tick sent, two delivered, two in colour read. */
export function Ticks({ status, size = 15, color }: { status?: string; size?: number; color?: string }) {
  const theme = useTheme();
  if (status === 'queued') return <Icon name="clock" size={size - 2} color={color ?? theme.muted} />;
  if (status === 'failed') return <Icon name="warning" size={size - 1} color={theme.danger} />;
  if (status === 'sent') return <Icon name="tick" size={size} color={color ?? theme.muted} stroke={2.2} />;
  return <Icon name="ticks" size={size} color={status === 'read' ? theme.read : (color ?? theme.muted)} stroke={2.2} />;
}
