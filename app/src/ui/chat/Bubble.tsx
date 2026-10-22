// Bubble.tsx: one message in a chat.
//
// Yours sit on the end side in your accent colour, theirs on the start side in
// white (or charcoal). Swipe a bubble towards the middle to reply to it: the
// reply arrow fades in as you pull, ticks when you've pulled enough, and the
// bubble springs back.
import type { Message } from '@pakchat/shared';
import { LinearGradient } from 'expo-linear-gradient';
import { memo, useEffect, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming, ZoomIn } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { core } from '../../core/core';
import { fill, useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { Ticks } from '../ChatRow';
import { clock, systemText } from '../format';
import { Icon } from '../icons';
import { fontStyle, hasUrdu, Pressy, Txt } from '../kit';
import { fade, smooth, snappy, tick } from '../motion';

const PULL = 64;

type Props = {
  m: Message;
  group: boolean;
  /** The message this one replies to, if we have it. */
  quoted: Message | null;
  /** First of a run from the same person: gets the name (groups) and the pointy corner. */
  first: boolean;
  /** The time now (from the screen's clock), for pins that run out. */
  now: number;
  starred: boolean;
  selecting: boolean;
  selected: boolean;
  onPress: (m: Message) => void;
  onLongPress: (m: Message) => void;
  onReply: (m: Message) => void;
  onVote: (m: Message, option: number) => void;
  onReaction: (m: Message, emoji: string) => void;
  onQuote: (m: Message) => void;
  onRetry: (m: Message) => void;
  /** Shown just above the bubble (the reactions bar when it's held). */
  above?: ReactNode;
};

export const Bubble = memo(function Bubble(p: Props) {
  const { m } = p;
  if (m.kind === 'system') return <SystemNote m={m} />;
  return <ChatBubble {...p} />;
});

function SystemNote({ m }: { m: Message }) {
  const t = useT();
  const { theme } = useLook();
  const text = systemText(m, t);
  if (!text) return null;
  return (
    <View style={{ alignSelf: 'center', maxWidth: '86%', marginVertical: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, backgroundColor: theme.glass }}>
      <Txt size={12.5} weight="500" color={theme.sectionText} align="center">
        {text}
      </Txt>
    </View>
  );
}

function ChatBubble({ m, group, quoted, first, now, starred, selecting, selected, onPress, onLongPress, onReply, onVote, onReaction, onQuote, onRetry, above }: Props) {
  const t = useT();
  const { theme, rtl, lang } = useLook();
  const mine = m.author === core.myId;
  const x = useSharedValue(0);
  const over = useSharedValue(0);
  const picked = useSharedValue(selected ? 1 : 0);

  useEffect(() => {
    picked.value = withTiming(selected ? 1 : 0, fade);
  }, [selected, picked]);

  // Towards the middle of the screen: right for theirs, left for mine (the other way round in Urdu).
  const dir = (mine ? -1 : 1) * (rtl ? -1 : 1);
  const pan = usePanGesture({
    enabled: !selecting && !m.deleted,
    activeOffsetX: dir > 0 ? [-1000, 16] : [-16, 1000],
    failOffsetY: [-12, 12],
    onUpdate: (e) => {
      'worklet';
      const pull = Math.max(0, e.translationX * dir);
      // Harder to pull the further it goes, so it never flies off.
      x.value = dir * (pull < PULL ? pull : PULL + (pull - PULL) * 0.25);
      const now = pull > PULL ? 1 : 0;
      if (now !== over.value) {
        over.value = now;
        scheduleOnRN(tick);
      }
    },
    onDeactivate: (e) => {
      'worklet';
      if (e.translationX * dir > PULL) scheduleOnRN(onReply, m);
      over.value = 0;
      x.value = withSpring(0, smooth);
    },
  });

  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const arrow = useAnimatedStyle(() => {
    const pull = Math.abs(x.value);
    return { opacity: interpolate(pull, [10, PULL], [0, 1], 'clamp'), transform: [{ scale: interpolate(pull, [0, PULL], [0.5, 1], 'clamp') }] };
  });
  const highlight = useAnimatedStyle(() => ({ opacity: picked.value }));

  const name = group && !mine && first ? core.name(m.author) || '…' : '';
  const urdu = !!m.text && hasUrdu(m.text);
  const meta = mine ? (theme.dark ? 'rgba(236,238,242,0.7)' : theme.sectionText) : theme.muted;
  const corner = 6;
  const radius = {
    borderTopStartRadius: 18,
    borderTopEndRadius: 18,
    borderBottomStartRadius: mine ? 18 : first ? corner : 18,
    borderBottomEndRadius: mine ? (first ? corner : 18) : 18,
  };
  const reactions = Object.entries(m.reactions ?? {});

  const body = (
    <View style={{ paddingHorizontal: 12, paddingTop: 7, paddingBottom: 6, minWidth: 72 }}>
      {!!name && (
        <Txt size={13} weight="700" color={theme.accInk} lines={1}>
          {name}
        </Txt>
      )}
      {m.forwarded && !m.deleted && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 }}>
          <Icon name="forward" size={13} color={meta} />
          <Txt size={12} color={meta} style={{ fontStyle: 'italic' }}>
            {t.forwarded}
          </Txt>
        </View>
      )}
      {/* While picking messages, a tap anywhere on the bubble picks it (no jumping, voting or retrying). */}
      {quoted && !m.deleted && <Quote m={quoted} mine={mine} onPress={() => (selecting ? onPress(m) : onQuote(quoted))} />}
      {m.deleted ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="close" size={14} color={meta} />
          <Txt size={14.5} color={meta} style={{ fontStyle: 'italic' }}>
            {mine ? t.youDeleted : t.deleted}
          </Txt>
        </View>
      ) : m.kind === 'poll' && m.poll ? (
        <Poll m={m} mine={mine} onVote={(i) => (selecting ? onPress(m) : onVote(m, i))} />
      ) : (
        <Text
          style={[
            fontStyle(m.text ?? '', lang, 15.5, '400'),
            { color: mine ? theme.bubbleMineText : theme.text, writingDirection: urdu ? 'rtl' : 'ltr', textAlign: urdu ? 'right' : 'left' },
          ]}
        >
          <Words text={m.text ?? ''} mentions={m.mentions} />
        </Text>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', gap: 3, marginTop: 2 }}>
        {starred && <Icon name="starFilled" size={11} color={meta} />}
        {!!m.pinnedUntil && m.pinnedUntil > now && <Icon name="pin" size={11} color={meta} />}
        {!!m.expiresAt && <Icon name="timer" size={11} color={meta} />}
        {!!m.editedAt && !m.deleted && (
          <Txt size={11} color={meta}>
            {t.edited}
          </Txt>
        )}
        <Txt size={11} color={meta}>
          {clock(m.sentAt)}
        </Txt>
        {mine && !m.deleted && <Ticks status={m.status} size={15} color={meta} />}
      </View>
    </View>
  );

  return (
    <View style={{ marginTop: first ? 6 : 2 }}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { marginHorizontal: -14, marginVertical: -2, backgroundColor: theme.selected }, highlight]} />
      {above}
      <View style={{ flexDirection: 'row', justifyContent: mine ? 'flex-end' : 'flex-start', alignItems: 'center' }}>
        {/* The reply arrow, waiting behind the bubble. */}
        <Animated.View style={[{ position: 'absolute' }, mine ? { end: 4 } : { start: 4 }, arrow]}>
          <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: theme.glass, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="reply" size={17} color={theme.accInk} flip />
          </View>
        </Animated.View>
        <GestureDetector gesture={pan}>
          <Animated.View style={[{ maxWidth: '80%' }, slide]}>
            <Pressy
              onPress={() => (m.status === 'failed' && !selecting ? onRetry(m) : onPress(m))}
              onLongPress={() => onLongPress(m)}
              scale={0.98}
              label={m.text ?? ''}
              testID={`msg-${m.text ?? m.id}`}
            >
              {mine ? (
                <LinearGradient
                  colors={theme.bubbleMine}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={[radius, { boxShadow: theme.dark ? undefined : `0 4px 12px -6px ${theme.acc}`, borderWidth: selected ? 2 : 0, borderColor: theme.acc }]}
                >
                  {body}
                </LinearGradient>
              ) : (
                <View
                  style={[
                    radius,
                    { backgroundColor: theme.bubbleIn, boxShadow: theme.dark ? undefined : '0 2px 8px -3px rgba(30,64,140,0.18)', borderWidth: selected ? 2 : 0, borderColor: theme.acc },
                  ]}
                >
                  {body}
                </View>
              )}
            </Pressy>
            {m.status === 'failed' && (
              <Txt size={11.5} weight="600" color={theme.danger} align="end" style={{ marginTop: 3 }}>
                {t.notSent}
              </Txt>
            )}
            {reactions.length > 0 && <Reactions list={reactions} mine={mine} onPress={(e) => (selecting ? onPress(m) : onReaction(m, e))} />}
          </Animated.View>
        </GestureDetector>
      </View>
    </View>
  );
}

/** Words, with @mentions in the accent colour. */
function Words({ text, mentions }: { text: string; mentions?: string[] }) {
  const { theme } = useLook();
  if (!mentions?.length) return <>{text}</>;
  const names = mentions.map((id) => `@${core.name(id)}`).filter((n) => n.length > 1);
  if (!names.length) return <>{text}</>;
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const parts = text.split(new RegExp(`(${escaped.join('|')})`, 'g'));
  return (
    <>
      {parts.map((part, i) =>
        names.includes(part) ? (
          <Text key={i} style={{ color: theme.mention, fontWeight: '600' }}>
            {part}
          </Text>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** The message being replied to, inside the bubble. Tap it to jump there. */
function Quote({ m, mine, onPress }: { m: Message; mine: boolean; onPress: () => void }) {
  const t = useT();
  const { theme } = useLook();
  const who = m.author === core.myId ? t.youWord : core.name(m.author) || '…';
  const text = m.deleted ? t.deleted : m.kind === 'poll' ? `${t.poll} ${m.poll?.question ?? ''}` : (m.text ?? '');
  return (
    <Pressy onPress={onPress} scale={0.98} label={text}>
      <View
        style={{
          borderStartWidth: 3,
          borderColor: theme.acc,
          borderRadius: 8,
          backgroundColor: mine ? (theme.dark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.55)') : theme.accSoft,
          paddingHorizontal: 9,
          paddingVertical: 5,
          marginBottom: 5,
          marginTop: 2,
        }}
      >
        <Txt size={13} weight="700" color={theme.accInk} lines={1}>
          {who}
        </Txt>
        <Txt size={13} color={theme.muted} lines={2}>
          {text}
        </Txt>
      </View>
    </Pressy>
  );
}

/** The little emoji chips under a bubble. Tap yours to take it back. */
function Reactions({ list, mine, onPress }: { list: [string, string][]; mine: boolean; onPress: (emoji: string) => void }) {
  const { theme } = useLook();
  const counts = new Map<string, { n: number; me: boolean }>();
  for (const [user, emoji] of list) {
    const c = counts.get(emoji) ?? { n: 0, me: false };
    counts.set(emoji, { n: c.n + 1, me: c.me || user === core.myId });
  }
  return (
    <View style={{ flexDirection: 'row', gap: 4, marginTop: -6, alignSelf: mine ? 'flex-end' : 'flex-start', marginHorizontal: 10 }}>
      {[...counts].map(([emoji, c]) => (
        <Animated.View key={emoji} entering={ZoomIn.springify().damping(12)}>
          <Pressy onPress={() => onPress(emoji)} scale={0.9} label={emoji}>
            <View
              style={{
                height: 26,
                paddingHorizontal: 8,
                borderRadius: 13,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 3,
                backgroundColor: c.me ? theme.accSoft : theme.bubbleIn,
                borderWidth: 1,
                borderColor: c.me ? theme.acc : theme.glassLine,
                boxShadow: theme.dark ? undefined : '0 2px 8px -3px rgba(30,64,140,0.25)',
              }}
            >
              <Text style={{ fontSize: 13 }}>{emoji}</Text>
              {c.n > 1 && (
                <Txt size={12} weight="600">
                  {c.n}
                </Txt>
              )}
            </View>
          </Pressy>
        </Animated.View>
      ))}
    </View>
  );
}

/** A poll: each answer is a bar that fills (on a spring) as votes come in. */
function Poll({ m, mine, onVote }: { m: Message; mine: boolean; onVote: (i: number) => void }) {
  const t = useT();
  const { theme } = useLook();
  const poll = m.poll!;
  const votes = Object.values(m.votes ?? {});
  const mineVotes = m.votes?.[core.myId] ?? [];
  const totals = poll.options.map((_, i) => votes.filter((v) => v.includes(i)).length);
  const voters = votes.filter((v) => v.length > 0).length;
  const most = Math.max(1, ...totals);
  return (
    <View style={{ gap: 8, minWidth: 220 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon name="poll" size={16} color={theme.accInk} />
        <View style={{ flex: 1 }}>
          <Txt size={15.5} weight="700" color={mine ? theme.bubbleMineText : theme.text}>
            {poll.question}
          </Txt>
        </View>
      </View>
      <Txt size={12} color={theme.muted}>
        {poll.multi ? t.pickMany : t.pickOne}
      </Txt>
      {poll.options.map((o, i) => (
        <PollOption key={i} text={o} count={totals[i]} share={totals[i] / most} on={mineVotes.includes(i)} onPress={() => onVote(i)} testID={`poll-${o}`} />
      ))}
      <Txt size={12} color={theme.muted} align="center">
        {fill(t.votes, { n: voters })}
      </Txt>
    </View>
  );
}

function PollOption({ text, count, share, on, onPress, testID }: { text: string; count: number; share: number; on: boolean; onPress: () => void; testID: string }) {
  const { theme } = useLook();
  const w = useSharedValue(share);
  useEffect(() => {
    w.value = withSpring(share, snappy);
  }, [share, w]);
  const bar = useAnimatedStyle(() => ({ width: `${Math.round(w.value * 100)}%` }));
  return (
    <Pressy onPress={onPress} scale={0.98} label={text} testID={testID}>
      <View style={{ gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View
            style={{
              width: 20,
              height: 20,
              borderRadius: 10,
              borderWidth: 2,
              borderColor: on ? theme.acc : theme.faint,
              backgroundColor: on ? theme.acc : 'transparent',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {on && <Icon name="check" size={12} color="#FFFFFF" stroke={3} />}
          </View>
          <View style={{ flex: 1 }}>
            <Txt size={14.5}>{text}</Txt>
          </View>
          <Txt size={13} weight="600" color={theme.muted}>
            {count}
          </Txt>
        </View>
        <View style={{ height: 6, borderRadius: 3, backgroundColor: theme.dark ? 'rgba(255,255,255,0.08)' : 'rgba(30,64,140,0.08)', marginStart: 28, overflow: 'hidden' }}>
          <Animated.View style={[{ height: 6, borderRadius: 3, backgroundColor: theme.acc }, bar]} />
        </View>
      </View>
    </Pressy>
  );
}

/** "Today", "Yesterday"… between days. */
export function DayLabel({ text }: { text: string }) {
  const { theme } = useLook();
  return (
    <View style={{ alignSelf: 'center', marginVertical: 8, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 10, backgroundColor: theme.glass }}>
      <Txt size={12} weight="600" color={theme.accInk} align="center">
        {text}
      </Txt>
    </View>
  );
}

/** Three dots that bob up and down while someone types. */
export function TypingDots({ name }: { name?: string }) {
  const { theme } = useLook();
  return (
    <Animated.View entering={ZoomIn.springify().damping(14)} style={{ alignSelf: 'flex-start', marginTop: 4, gap: 3 }}>
      {!!name && (
        <Txt size={11.5} weight="600" color={theme.muted} style={{ marginStart: 6 }}>
          {name}
        </Txt>
      )}
      <View
        style={{
          flexDirection: 'row',
          gap: 4,
          paddingHorizontal: 14,
          paddingVertical: 12,
          borderRadius: 16,
          backgroundColor: theme.bubbleIn,
          boxShadow: theme.dark ? undefined : '0 2px 8px -3px rgba(30,64,140,0.18)',
        }}
        accessibilityLabel="typing"
      >
        {[0, 1, 2].map((i) => (
          <Dot key={i} delay={i * 150} />
        ))}
      </View>
    </Animated.View>
  );
}

function Dot({ delay }: { delay: number }) {
  const { theme, reduceMotion } = useLook();
  const y = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) return;
    let alive = true;
    // Up, down, rest; then again, each dot a little after the one before.
    const bob = () => {
      if (!alive) return;
      y.value = withSpring(-4, snappy, () => {
        'worklet';
        y.value = withSpring(0, snappy);
      });
    };
    const start = setTimeout(() => {
      bob();
      timer = setInterval(bob, 900);
    }, delay);
    let timer: ReturnType<typeof setInterval> | undefined;
    return () => {
      alive = false;
      clearTimeout(start);
      if (timer) clearInterval(timer);
    };
  }, [delay, reduceMotion, y]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }], opacity: interpolate(y.value, [-4, 0], [1, 0.45]) }));
  return <Animated.View style={[{ width: 7, height: 7, borderRadius: 4, backgroundColor: theme.acc }, style]} />;
}
