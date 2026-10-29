// Bubble.tsx: one message in a chat.
//
// Yours sit on the end side in your accent colour, theirs on the start side in
// white (or charcoal). Swipe a bubble towards the middle to reply to it: the
// reply arrow fades in as you pull, ticks when you've pulled enough, and the
// bubble springs back.
import type { Message } from '@pakchat/shared';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { memo, useEffect, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { FadeOut, interpolate, LayoutAnimationConfig, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { core } from '../../core/core';
import { emojiOnly } from '../../core/richText';
import { slowPhone } from '../../core/phone';
import { fill, useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { Ticks } from '../ChatRow';
import { FileBody } from './FileBody';
import { ChatQuoteView, ContactBody, EventBody, LinkBody, LocationBody, OnceBody, RoundBody } from './MoreBodies';
import { AlbumBody } from './Album';
import { BigEmoji, RichWords } from './RichText';
import { VoiceBody } from './VoiceBody';
import { bodyLine, clock, systemText } from '../format';
import { Icon } from '../icons';
import { fontStyle, hasUrdu, Pressy, Txt } from '../kit';
import { fadeIn, fadeOut, popIn, popOut, smooth, tick } from '../motion';

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
  /** Just jumped to (from search or a quoted reply): it lights up for a moment. */
  flash?: boolean;
  onPress: (m: Message) => void;
  onLongPress: (m: Message) => void;
  onReply: (m: Message) => void;
  onVote: (m: Message, option: number) => void;
  onReaction: (m: Message, emoji: string) => void;
  onQuote: (m: Message) => void;
  onRetry: (m: Message) => void;
  /** Shown just above the bubble (the reactions bar when it's held). */
  above?: ReactNode;
  /** Photos and videos sent together (oldest first, `m` the newest): one album (Album.tsx). */
  album?: Message[];
  /** How big the words are (Settings › Chats › Font size). */
  textSize: number;
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

function ChatBubble({ m, group, quoted, first, now, starred, selecting, selected, flash, onPress, onLongPress, onReply, onVote, onReaction, onQuote, onRetry, above, album, textSize }: Props) {
  const t = useT();
  const { theme, rtl, lang } = useLook();
  const mine = m.author === core.myId;
  const x = useSharedValue(0);
  const over = useSharedValue(0);

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
  // A sticker (and a round video) has no bubble: just the picture, with the time on a little pill under it.
  // One to three emoji on their own are shown big, with no bubble either (like WhatsApp).
  const big = !m.deleted && m.kind === 'text' && !quoted && !m.link && !m.forwarded && !m.quote && !m.statusReply ? emojiOnly(m.text ?? '') : 0;
  const bare = big > 0 || (!m.deleted && m.kind === 'file' && (m.file?.kind === 'sticker' || (!!m.file?.round && !m.file.once)));

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
      {m.statusReply && !m.deleted && <StatusQuoteView q={m.statusReply} mine={mine} />}
      {m.quote && !m.deleted && <ChatQuoteView q={m.quote} mine={mine} />}
      {m.deleted ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="close" size={14} color={meta} />
          <Txt size={14.5} color={meta} style={{ fontStyle: 'italic' }}>
            {mine ? t.youDeleted : t.deleted}
          </Txt>
        </View>
      ) : m.kind === 'poll' && m.poll ? (
        <Poll
          m={m}
          mine={mine}
          onVote={(i) => (selecting ? onPress(m) : onVote(m, i))}
          onView={() => (selecting ? onPress(m) : router.push({ pathname: '/poll-votes', params: { chat: m.chatId, author: m.author, id: m.id } }))}
        />
      ) : m.kind === 'location' && m.location ? (
        <LocationBody m={m} mine={mine} />
      ) : m.kind === 'contact' && m.contacts ? (
        <ContactBody m={m} mine={mine} />
      ) : m.kind === 'event' && m.plan ? (
        <EventBody m={m} mine={mine} />
      ) : album ? (
        <AlbumBody ms={album} mine={mine} selecting={selecting} onPick={() => (selecting ? onPress(m) : onLongPress(m))} />
      ) : m.kind === 'file' && m.file ? (
        <>
          {m.file.once ? (
            <OnceBody m={m} mine={mine} selecting={selecting} onPick={() => (selecting ? onPress(m) : onLongPress(m))} />
          ) : m.file.kind === 'voice' || m.file.kind === 'audio' ? (
            <VoiceBody m={m} mine={mine} selecting={selecting} onPick={() => (selecting ? onPress(m) : onLongPress(m))} />
          ) : (
            <FileBody m={m} mine={mine} selecting={selecting} onPick={() => (selecting ? onPress(m) : onLongPress(m))} />
          )}
          {!!m.text && (
            <Text
              style={[
                fontStyle(m.text, lang, textSize, '400'),
                { color: mine ? theme.bubbleMineText : theme.text, writingDirection: urdu ? 'rtl' : 'ltr', textAlign: urdu ? 'right' : 'left', maxWidth: 236 },
              ]}
            >
              <RichWords text={m.text} mentions={m.mentions} color={mine ? theme.bubbleMineText : theme.text} mine={mine} />
            </Text>
          )}
        </>
      ) : (
        <>
          {m.link && <LinkBody link={m.link} mine={mine} />}
          <Text
            style={[
              fontStyle(m.text ?? '', lang, textSize, '400'),
              { color: mine ? theme.bubbleMineText : theme.text, writingDirection: urdu ? 'rtl' : 'ltr', textAlign: urdu ? 'right' : 'left' },
            ]}
          >
            <RichWords text={m.text ?? ''} mentions={m.mentions} color={mine ? theme.bubbleMineText : theme.text} mine={mine} />
          </Text>
        </>
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
    // What comes later (the picked tint, a reaction) fades or pops in, like WhatsApp's; not when the bubble first shows.
    <LayoutAnimationConfig skipEntering>
      <View style={{ marginTop: first ? 6 : 2 }}>
        {/* The picked-message tint; and the same, for a moment, on a message just jumped to (the chat
            turns `flash` off, and it fades slowly away, like WhatsApp's). */}
        {(selected || flash) && (
          <Animated.View
            entering={fadeIn}
            exiting={flash ? FadeOut.duration(600) : fadeOut}
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { marginHorizontal: -14, marginVertical: -2, backgroundColor: theme.selected }]}
          />
        )}
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
                {bare ? (
                  <View style={{ alignItems: mine ? 'flex-end' : 'flex-start', gap: 4, borderRadius: 18, borderWidth: selected ? 2 : 0, borderColor: theme.acc, padding: selected ? 4 : 0 }}>
                    {!!name && (
                      <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, backgroundColor: theme.glass }}>
                        <Txt size={12.5} weight="700" color={theme.accInk} lines={1}>
                          {name}
                        </Txt>
                      </View>
                    )}
                    {quoted && (
                      <View style={{ maxWidth: 236, padding: 4, borderRadius: 12, backgroundColor: theme.bubbleIn }}>
                        <Quote m={quoted} mine={false} onPress={() => (selecting ? onPress(m) : onQuote(quoted))} />
                      </View>
                    )}
                    {big > 0 ? (
                      <BigEmoji text={m.text ?? ''} count={big} />
                    ) : m.file?.round ? (
                      <RoundBody m={m} mine={mine} selecting={selecting} onPick={() => (selecting ? onPress(m) : onLongPress(m))} />
                    ) : (
                      <FileBody m={m} mine={mine} selecting={selecting} onPick={() => (selecting ? onPress(m) : onLongPress(m))} />
                    )}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 9, backgroundColor: theme.glass }}>
                      {starred && <Icon name="starFilled" size={11} color={theme.muted} />}
                      {!!m.expiresAt && <Icon name="timer" size={11} color={theme.muted} />}
                      <Txt size={11} color={theme.muted}>
                        {clock(m.sentAt)}
                      </Txt>
                      {mine && <Ticks status={m.status} size={15} color={theme.muted} />}
                    </View>
                  </View>
                ) : mine && (slowPhone || theme.bubbleMine[0] === theme.bubbleMine[1]) ? (
                  // One plain colour: on a slower phone (the colour fade and its clipping cost a lot
                  // there), and in the dark look, whose "fade" is one colour anyway.
                  <View style={[radius, { backgroundColor: middle(theme.bubbleMine), borderWidth: selected ? 2 : 0, borderColor: theme.acc }]}>{body}</View>
                ) : mine ? (
                  // The gradient can't round its own corners one by one on Android (it came
                  // out square), so a plain View with the corners clips it instead.
                  <View
                    style={[
                      radius,
                      { overflow: 'hidden', boxShadow: theme.dark ? undefined : `0 4px 12px -6px ${theme.acc}`, borderWidth: selected ? 2 : 0, borderColor: theme.acc },
                    ]}
                  >
                    <LinearGradient colors={theme.bubbleMine} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
                    {body}
                  </View>
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
    </LayoutAnimationConfig>
  );
}

/** The message being replied to, inside the bubble. Tap it to jump there. */
function Quote({ m, mine, onPress }: { m: Message; mine: boolean; onPress: () => void }) {
  const t = useT();
  const { theme } = useLook();
  const who = m.author === core.myId ? t.youWord : core.name(m.author) || '…';
  const text = m.deleted ? t.deleted : bodyLine(m, t);
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

/** A reply to a status: "Status · Sara" with a little copy of it (the status itself goes after a day). */
function StatusQuoteView({ q, mine }: { q: NonNullable<Message['statusReply']>; mine: boolean }) {
  const t = useT();
  const { theme } = useLook();
  const who = q.author === core.myId ? t.youWord : core.name(q.author) || '…';
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        borderStartWidth: 3,
        borderColor: theme.acc,
        borderRadius: 8,
        backgroundColor: mine ? (theme.dark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.55)') : theme.accSoft,
        paddingStart: 9,
        marginBottom: 5,
        marginTop: 2,
        overflow: 'hidden',
      }}
      testID="status-quote"
    >
      <View style={{ flex: 1, paddingVertical: 5 }}>
        <Txt size={13} weight="700" color={theme.accInk} lines={1}>
          {`${who} · ${t.status}`}
        </Txt>
        <Txt size={13} color={theme.muted} lines={2}>
          {q.text ?? (q.kind === 'video' ? t.videoLabel : t.photoLabel)}
        </Txt>
      </View>
      {q.thumb && <Image source={{ uri: `data:image/jpeg;base64,${q.thumb}` }} style={{ width: 44, height: 52 }} contentFit="cover" />}
    </View>
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
        <Animated.View key={emoji} entering={popIn} exiting={popOut}>
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
function Poll({ m, mine, onVote, onView }: { m: Message; mine: boolean; onVote: (i: number) => void; onView: () => void }) {
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
      <Pressy onPress={onView} label={t.viewVotes} scale={0.96} testID="poll-view-votes">
        <View style={{ borderTopWidth: 1, borderColor: mine ? 'rgba(255,255,255,0.25)' : theme.divider, paddingTop: 8, alignItems: 'center' }}>
          <Txt size={14} weight="700" color={mine ? theme.bubbleMineText : theme.accInk}>
            {t.viewVotes}
          </Txt>
        </View>
      </Pressy>
    </View>
  );
}

function PollOption({ text, count, share, on, onPress, testID }: { text: string; count: number; share: number; on: boolean; onPress: () => void; testID: string }) {
  const { theme } = useLook();
  const w = useSharedValue(share);
  useEffect(() => {
    w.value = share;
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
    <Animated.View style={{ alignSelf: 'flex-start', marginTop: 4, gap: 3 }}>
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
  // Still dots (they used to bob): the words "typing…" at the top say it too, and nothing moves.
  const { theme } = useLook();
  return <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: theme.acc, opacity: delay ? 0.7 : 1 }} />;
}

/** The colour halfway along a two-colour fade ("#RRGGBB" each), for the plain bubble. */
const middles = new Map<string, string>();
function middle([a, b]: [string, string]) {
  const key = a + b;
  let out = middles.get(key);
  if (!out) {
    const ch = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
    const ok = /^#[0-9a-f]{6}$/i.test(a) && /^#[0-9a-f]{6}$/i.test(b);
    out = ok ? `#${[0, 1, 2].map((i) => Math.round((ch(a, i) + ch(b, i)) / 2).toString(16).padStart(2, '0')).join('')}` : a;
    middles.set(key, out);
  }
  return out;
}
