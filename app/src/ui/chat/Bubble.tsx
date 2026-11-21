// Bubble.tsx: one message in a chat.
//
// Yours sit on the end side in your accent colour, theirs on the start side in
// white (or charcoal). Swipe a bubble towards the middle to reply to it: the
// reply arrow fades in as you pull, ticks when you've pulled enough, and the
// bubble springs back.
import { forwardedMany, type Message } from '@pakchat/shared';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { memo, useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, FadeOut, interpolate, LayoutAnimationConfig, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
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
import { bodyLine, callInfo, clock, heldNames, isCallNote, systemText } from '../format';
import { startCall } from '../CallBar';
import { Dialog } from '../overlays';
import { Icon } from '../icons';
import { haveFile } from '../../core/files';
import { Avatar, fontStyle, hasUrdu, Pressy, Txt } from '../kit';
import { QuoteThumb } from './QuoteThumb';
import { hash } from '../letters';
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
  /** Tap on the reactions under a bubble: who reacted with what. */
  onReactions?: (m: Message) => void;
  /** The quick round arrow beside a photo, video or link: forward just that one. */
  onForward?: (m: Message) => void;
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
  if (isCallNote(m)) return <CallNote m={m} selecting={p.selecting} onLongPress={p.onLongPress} />;
  if (m.kind === 'system') return <SystemNote m={m} />;
  return <ChatBubble {...p} />;
});

/** The reply arrow behind a bubble being pulled: it fades and grows in as the bubble moves. */
function ReplyArrow({ x }: { x: SharedValue<number> }) {
  const { theme } = useLook();
  const arrow = useAnimatedStyle(() => {
    const pull = Math.abs(x.value);
    return { opacity: interpolate(pull, [10, PULL], [0, 1], 'clamp'), transform: [{ scale: interpolate(pull, [0, PULL], [0.5, 1], 'clamp') }] };
  });
  return (
    <Animated.View style={[{ position: 'absolute', start: 4 }, arrow]}>
      <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: theme.glass, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="reply" size={17} color={theme.accInk} flip />
      </View>
    </Animated.View>
  );
}

/**
 * A call, like WhatsApp's call bubble: on the side of whoever started it, with the
 * way it went, and red when I missed it. Tap: call back (after asking). Hold: take it out of the chat.
 */
function CallNote({ m, selecting, onLongPress }: { m: Message; selecting: boolean; onLongPress: (m: Message) => void }) {
  const t = useT();
  const { theme } = useLook();
  const c = callInfo(m, t);
  const mine = c.out;
  const ink = c.missed ? theme.danger : mine ? theme.bubbleMineText : theme.text;
  const meta = mine ? (theme.dark ? 'rgba(236,238,242,0.7)' : theme.sectionText) : theme.muted;
  const box = c.missed ? 'rgba(239,68,68,0.15)' : theme.dark ? 'rgba(255,255,255,0.1)' : 'rgba(11,27,54,0.06)';
  const R = 10;
  // Asks first, like WhatsApp: a stray tap while scrolling mustn't ring anyone (a whole group).
  const [ask, setAsk] = useState<string | null>(null);
  const group = m.event?.group === true;
  return (
    <View style={{ marginTop: 6, flexDirection: 'row', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
      <Dialog
        visible={ask !== null}
        onClose={() => setAsk(null)}
        title={fill(group ? (c.video ? t.askGroupVideoCall : t.askGroupCall) : c.video ? t.askVideoCall : t.askCall, { name: ask ?? '' })}
        buttons={[
          {
            label: c.video ? t.videoCall : t.voiceCall,
            testID: 'call-note-call',
            onPress: () => {
              setAsk(null);
              void startCall(m.chatId, c.video, t);
            },
          },
          { label: t.cancel, onPress: () => setAsk(null) },
        ]}
      />
      <Pressy
        onPress={() => {
          if (selecting) return;
          void core.storage.getChat(m.chatId).then((chat) => {
            if (chat) setAsk(core.chatTitle(chat));
          });
        }}
        onLongPress={() => onLongPress(m)}
        label={c.sub ? `${c.title}, ${c.sub}` : c.title}
        scale={0.98}
        style={{ borderRadius: R }}
        testID="call-note"
      >
        <View
          style={{
            minWidth: 210,
            maxWidth: 290,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            paddingStart: 8,
            paddingEnd: 12,
            paddingVertical: 8,
            borderRadius: R,
            borderTopStartRadius: mine ? R : 3,
            borderTopEndRadius: mine ? 3 : R,
            backgroundColor: mine ? middle(theme.bubbleMine) : theme.bubbleIn,
            boxShadow: theme.dark ? undefined : '0 2px 8px -3px rgba(30,64,140,0.18)',
          }}
        >
          <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: box, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={c.icon} size={21} color={ink} />
          </View>
          {/* Room at the end for the time, under it. */}
          <View style={{ flexShrink: 1, paddingEnd: 38 }}>
            <Txt size={15} weight="700" color={ink} lines={1}>
              {c.title}
            </Txt>
            {!!c.sub && (
              <Txt size={12.5} color={meta} lines={1}>
                {c.sub}
              </Txt>
            )}
          </View>
          <Txt size={11} color={meta} style={{ position: 'absolute', end: 10, bottom: 6 }}>
            {clock(m.sentAt)}
          </Txt>
        </View>
      </Pressy>
    </View>
  );
}

function SystemNote({ m }: { m: Message }) {
  const t = useT();
  const { theme } = useLook();
  const text = systemText(m, t);
  if (!text) return null;
  const note = (
    <View style={{ alignSelf: 'center', maxWidth: '86%', marginVertical: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, backgroundColor: theme.glass, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      {m.event?.event === 'code_changed' && <Icon name="shield" size={14} color={theme.accInk} />}
      <Txt size={12.5} weight="500" color={theme.sectionText} align="center" style={{ flexShrink: 1 }}>
        {text}
      </Txt>
    </View>
  );
  // "Security code changed": tap to compare the codes (Verify).
  if (m.event?.event === 'code_changed')
    return (
      <Pressy onPress={() => router.push({ pathname: '/verify/[id]', params: { id: m.event!.by } })} label={text} scale={0.98} style={{ alignSelf: 'center' }} testID="code-changed">
        {note}
      </Pressy>
    );
  return note;
}

function ChatBubble({ m, group, quoted, first, now, starred, selecting, selected, flash, onPress, onLongPress, onReply, onVote, onReaction, onReactions, onForward, onQuote, onRetry, above, album, textSize }: Props) {
  const t = useT();
  const { theme, rtl, lang } = useLook();
  const mine = m.author === core.myId;
  // In a long chat the list reuses a bubble that scrolled away for one coming into view (it's
  // quicker than making a new one). Everything that belongs to one message (the words, the photo,
  // a voice note, a poll…) hangs off this key, so it all starts fresh for the new message and
  // nothing is left over from the old one. Only the bubble's frame is reused.
  const k = `${m.author}/${m.id}`;
  const x = useSharedValue(0);
  const over = useSharedValue(0);
  // The reply arrow behind the bubble is only made once it's first pulled: a chat opens with
  // a dozen bubbles at once, and each one's waiting arrow slowed that down (owner, 3 Nov).
  const [pulled, setPulled] = useState(false);
  const armed = useSharedValue(0);

  // Every message swipes to the right to reply, mine too, like WhatsApp (left in Urdu).
  const dir = rtl ? -1 : 1;
  const pan = usePanGesture({
    enabled: !selecting && !m.deleted,
    activeOffsetX: dir > 0 ? [-1000, 16] : [-16, 1000],
    failOffsetY: [-12, 12],
    onUpdate: (e) => {
      'worklet';
      const pull = Math.max(0, e.translationX * dir);
      if (!armed.value && pull > 0) {
        armed.value = 1;
        scheduleOnRN(setPulled, true);
      }
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

  const name = group && !mine && first ? core.name(m.author) || '…' : '';
  const urdu = !!m.text && hasUrdu(m.text);
  // The time (and ticks) sit on the text's last line when there's room, like WhatsApp: "Hi 10:01 am",
  // not "Hi" with the time on a line of its own (owner, 3 Nov). The text ends with an invisible copy
  // of them, so a line too full for it pushes the time onto the next line by itself.
  // Urdu words run right to left, so their last line ends on the left: the time sits there instead.
  const inline = !m.deleted && m.kind === 'text' && !!m.text && !m.link && (urdu || !rtl);
  const meta = mine ? (theme.dark ? 'rgba(236,238,242,0.7)' : theme.sectionText) : theme.muted;
  // Smaller corners than before, and the first bubble of a run has a little tail at the top
  // on the sender's side, like WhatsApp (its corner there is square, the tail carries on from it).
  const R = 10;
  const radius = {
    borderTopStartRadius: !mine && first ? 0 : R,
    borderTopEndRadius: mine && first ? 0 : R,
    borderBottomStartRadius: R,
    borderBottomEndRadius: R,
  };
  // A photo or video fills its bubble, with only a thin edge round it (and the time on the photo).
  const photo = !m.deleted && m.kind === 'file' && !!m.file && (album ? true : (m.file.kind === 'image' || m.file.kind === 'video') && !m.file.once);
  const onPhoto = photo && !m.text;
  // A voice note's time sits on the line under its bars, at the end (under the photo), like WhatsApp.
  const onVoice = !m.deleted && m.kind === 'file' && !!m.file && !m.file.once && (m.file.kind === 'voice' || m.file.kind === 'audio') && !m.text && !album;
  // Room the voice note leaves for that time at its end: the time and ticks, plus a star, pin,
  // timer, "kept" or "edited" when they show, so they never sit on the length or Aa.
  const voiceRoom = !onVoice
    ? 0
    : 64 +
      (starred ? 14 : 0) +
      (m.pinnedUntil && m.pinnedUntil > now ? 14 : 0) +
      (m.expiresAt ? 14 : 0) +
      (m.keptBy ? t.keptWord.length * 6.5 + 3 : 0) +
      (m.editedAt ? t.edited.length * 6.5 + 3 : 0);
  const inset = photo ? { paddingHorizontal: 6 } : null;
  const reactions = Object.entries(m.reactions ?? {});
  // A sticker (and a round video) has no bubble: just the picture, with the time on a little pill under it.
  // One to three emoji on their own are shown big, with no bubble either (like WhatsApp).
  const big = !m.deleted && m.kind === 'text' && !quoted && !m.link && !m.forwarded && !m.quote && !m.statusReply ? emojiOnly(m.text ?? '') : 0;
  const bare = big > 0 || (!m.deleted && m.kind === 'file' && (m.file?.kind === 'sticker' || (!!m.file?.round && !m.file.once)));

  const metaInk = onPhoto ? '#FFFFFF' : meta;
  // The quick forward arrow: photos and videos once they're on this phone, and links.
  const quick = !!onForward && !selecting && !m.deleted && !album && ((photo && haveFile(m)) || (m.kind === 'text' && !!m.link));
  const arrow = quick ? (
    <Pressy onPress={() => onForward(m)} label={t.forward} round testID="quick-forward">
      <View style={{ width: 32, height: 32, borderRadius: 16, marginHorizontal: 8, backgroundColor: theme.glass, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="forward" size={17} color={theme.muted} />
      </View>
    </Pressy>
  ) : null;
  // In a group, the sender's photo beside the first bubble of their run (a space beside the rest).
  const face = group && !mine;
  const tail = first && !bare ? <Tail mine={mine} colour={mine ? middle(theme.bubbleMine) : theme.bubbleIn} /> : null;

  const body = (
    <View key={k} style={photo ? { padding: 3 } : { paddingHorizontal: 12, paddingTop: onVoice ? 5 : 7, paddingBottom: onVoice ? 5 : 6, minWidth: 72 }}>
      {!!name && (
        <Txt size={13} weight="700" color={nameColour(m.author, theme.dark)} lines={1} style={[inset, photo && { paddingTop: 2, paddingBottom: 2 }]}>
          {name}
        </Txt>
      )}
      {m.forwarded && !m.deleted && (
        <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 }, inset]}>
          <Icon name="forward" size={13} color={meta} />
          {/* Forwarded many times: WhatsApp's double arrow. */}
          {forwardedMany(m) && (
            <View style={{ marginLeft: -11 }}>
              <Icon name="forward" size={13} color={meta} />
            </View>
          )}
          <Txt size={12} color={meta} style={{ fontStyle: 'italic' }}>
            {forwardedMany(m) ? t.forwardedManyTimes : t.forwarded}
          </Txt>
        </View>
      )}
      {/* While picking messages, a tap anywhere on the bubble picks it (no jumping, voting or retrying). */}
      {quoted && !m.deleted && (
        <View style={photo ? { marginBottom: -2 } : null}>
          <Quote m={quoted} mine={mine} onPress={() => (selecting ? onPress(m) : onQuote(quoted))} />
        </View>
      )}
      {m.statusReply && !m.deleted && <StatusQuoteView q={m.statusReply} mine={mine} />}
      {m.quote && !m.deleted && <ChatQuoteView q={m.quote} mine={mine} />}
      {m.deleted ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="ban" size={15} color={meta} />
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
            <VoiceBody m={m} mine={mine} metaRoom={voiceRoom} selecting={selecting} onPick={() => (selecting ? onPress(m) : onLongPress(m))} />
          ) : (
            <FileBody m={m} mine={mine} selecting={selecting} onPick={() => (selecting ? onPress(m) : onLongPress(m))} />
          )}
          {!!m.text && (
            <Text
              style={[
                fontStyle(m.text, lang, textSize, '400'),
                { color: mine ? theme.bubbleMineText : theme.text, writingDirection: urdu ? 'rtl' : 'ltr', textAlign: urdu ? 'right' : 'left', maxWidth: 236, paddingHorizontal: photo ? 6 : 0, paddingTop: photo ? 4 : 0 },
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
            {inline && (
              // Not 'transparent': React Native reads a fully clear colour as "no colour" and gives
              // the words the message's colour instead (the time showed twice on build 24). One step
              // above clear is still invisible.
              <Text style={{ fontSize: 11, color: 'rgba(0,0,0,0.004)' }}>
                {'\u2002\u2002' +
                  (starred ? '\u2003\u2009' : '') +
                  (m.pinnedUntil && m.pinnedUntil > now ? '\u2003\u2009' : '') +
                  (m.expiresAt ? '\u2003\u2009' : '') +
                  (m.keptBy ? `${t.keptWord} ` : '') +
                  (m.editedAt ? `${t.edited} ` : '') +
                  clock(m.sentAt) +
                  (mine ? '\u2009\u2003\u2002' : '')}
              </Text>
            )}
          </Text>
        </>
      )}
      <View
        style={
          onPhoto
            ? // Written on the photo's bottom corner, like WhatsApp.
              { position: 'absolute', end: 9, bottom: 8, flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 9, backgroundColor: 'rgba(0,0,0,0.32)' }
            : inline
              ? { position: 'absolute', ...(urdu ? { start: 12 } : { end: 12 }), bottom: 6, flexDirection: 'row', alignItems: 'center', gap: 3 }
              : onVoice
                ? { position: 'absolute', end: 12, bottom: 6, flexDirection: 'row', alignItems: 'center', gap: 3 }
              : { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', gap: 3, marginTop: 2, marginEnd: photo ? 6 : 0, marginBottom: photo ? 2 : 0 }
        }
      >
        {starred && <Icon name="starFilled" size={11} color={metaInk} />}
        {!!m.pinnedUntil && m.pinnedUntil > now && <Icon name="pin" size={11} color={metaInk} />}
        {!!m.expiresAt && <Icon name="timer" size={11} color={metaInk} />}
        {!!m.keptBy && !m.deleted && (
          <Txt size={11} color={metaInk}>
            {t.keptWord}
          </Txt>
        )}
        {!!m.editedAt && !m.deleted && (
          <Txt size={11} color={metaInk}>
            {t.edited}
          </Txt>
        )}
        <Txt size={11} color={metaInk}>
          {clock(m.sentAt)}
        </Txt>
        {mine && !m.deleted && <Ticks status={m.status} size={15} color={metaInk} />}
      </View>
    </View>
  );

  return (
    // What comes later (the picked tint, a reaction) fades or pops in, like WhatsApp's; not when the bubble first shows.
    <LayoutAnimationConfig skipEntering>
      <View style={{ marginTop: first ? 6 : 2 }}>
        {/* The picked-message tint; and the same, for a moment, on a message just jumped to (the chat
            turns `flash` off, and it fades slowly away, like WhatsApp's). */}
        {/* (Keyed too: a reused bubble's tint shows or goes at once, without fading.) */}
        <LayoutAnimationConfig key={k} skipEntering skipExiting>
          {(selected || flash) && (
            <Animated.View
              entering={fadeIn}
              exiting={flash ? FadeOut.duration(600) : fadeOut}
              pointerEvents="none"
              style={[StyleSheet.absoluteFill, { marginHorizontal: -14, marginVertical: -2, backgroundColor: theme.selected }]}
            />
          )}
        </LayoutAnimationConfig>
        {above}
        {/* The whole row answers a hold (and, while picking, a tap), not only the bubble, like
            WhatsApp: holding the empty space beside a message picks it too. The bubble's own
            press comes first where the finger is on it. */}
        <Pressable
          onLongPress={() => onLongPress(m)}
          onPress={selecting ? () => onPress(m) : undefined}
          accessible={false}
          style={{ flexDirection: 'row', justifyContent: mine ? 'flex-end' : 'flex-start', alignItems: 'center'}}
        >
          {/* The reply arrow, behind the bubble (made the first time it's pulled). */}
          {pulled && <ReplyArrow x={x} />}
          {face && (
            <View style={{ width: 30, marginEnd: 6, alignSelf: 'flex-start' }}>
              {first && (
                <Pressy onPress={() => void core.client.openDirect(m.author).then((c) => router.push({ pathname: '/chat/[id]', params: { id: c.id } })).catch(() => {})} round label={core.name(m.author) || '…'} testID="msg-face">
                  <Avatar id={m.author} name={core.name(m.author) || '…'} size={30} />
                </Pressy>
              )}
            </View>
          )}
          {mine && arrow}
          <GestureDetector gesture={pan}>
            <Animated.View style={[{ maxWidth: '80%' }, slide]}>
              <Pressy
                onPress={() => ((m.status === 'failed' || !!m.heldFor?.length) && !selecting ? onRetry(m) : onPress(m))}
                onLongPress={() => onLongPress(m)}
                scale={0.98}
                label={m.text ?? ''}
                testID={`msg-${m.text ?? m.id}`}
              >
                {bare ? (
                  <View key={k} style={{ alignItems: mine ? 'flex-end' : 'flex-start', gap: 4, borderRadius: 18 }}>
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
                    {/* A sticker sent as a reply to a status: which status, as in a normal bubble. */}
                    {m.statusReply && !m.deleted && (
                      <View style={{ width: 236, paddingHorizontal: 4, paddingTop: 2, paddingBottom: 0, borderRadius: 12, backgroundColor: theme.bubbleIn }}>
                        <StatusQuoteView q={m.statusReply} mine={false} />
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
                  <View style={[radius, { backgroundColor: middle(theme.bubbleMine) }]}>
                    {body}
                    {tail}
                  </View>
                ) : mine ? (
                  // The gradient can't round its own corners one by one on Android (it came
                  // out square), so a plain View with the corners clips it instead.
                  // (The tail sits outside the clipped part, so it isn't cut off.)
                  <View style={radius}>
                    <View
                      style={[
                        radius,
                        { overflow: 'hidden', boxShadow: theme.dark ? undefined : `0 4px 12px -6px ${theme.acc}` },
                      ]}
                    >
                      <LinearGradient colors={theme.bubbleMine} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
                      {body}
                    </View>
                    {tail && <Tail mine colour={middle(theme.bubbleMine)} />}
                  </View>
                ) : (
                  <View
                    style={[
                      radius,
                      { backgroundColor: theme.bubbleIn, boxShadow: theme.dark ? undefined : '0 2px 8px -3px rgba(30,64,140,0.18)' },
                    ]}
                  >
                    {body}
                    {tail}
                  </View>
                )}
              </Pressy>
              {m.status === 'failed' && (
                <Txt size={11.5} weight="600" color={theme.danger} align="end" style={{ marginTop: 3 }}>
                  {t.notSent}
                </Txt>
              )}
              {/* Asked for again with a new security code, after they had it: waits for a tap (shared client, sendHeld). */}
              {!!m.heldFor?.length && m.status !== 'failed' && (
                <Txt size={11.5} weight="600" color={theme.danger} align="end" style={{ marginTop: 3 }} testID="msg-held">
                  {fill(t.heldNotSent, { name: heldNames(m.heldFor) })}
                </Txt>
              )}
              {/* A reused bubble's reactions just show (or go); one added or taken away pops. */}
              <LayoutAnimationConfig key={k} skipEntering skipExiting>
                {reactions.length > 0 && <Reactions list={reactions} mine={mine} onPress={() => (selecting ? onPress(m) : onReactions ? onReactions(m) : onReaction(m, m.reactions?.[core.myId] ?? reactions[0][1]))} />}
              </LayoutAnimationConfig>
            </Animated.View>
          </GestureDetector>
          {!mine && arrow}
        </Pressable>
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
          flexDirection: 'row',
          borderStartWidth: 3,
          borderColor: theme.acc,
          borderRadius: 8,
          backgroundColor: mine ? (theme.dark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.55)') : theme.accSoft,
          marginBottom: 5,
          marginTop: 2,
          overflow: 'hidden',
        }}
      >
        <View style={{ flexShrink: 1, flexGrow: 1, paddingHorizontal: 9, paddingVertical: 5 }}>
          <Txt size={13} weight="700" color={nameColourOrAcc(m, theme)} lines={1}>
            {who}
          </Txt>
          <Txt size={13} color={theme.muted} lines={2}>
            {text}
          </Txt>
        </View>
        {/* A photo or video answered shows a little picture of it, like WhatsApp. */}
        <QuoteThumb m={m} size={50} />
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

/**
 * The reactions under a bubble: one pill holding the emoji (the three used most) and how
 * many reacted, like WhatsApp. Tap it to see who reacted with what.
 */
function Reactions({ list, mine, onPress }: { list: [string, string][]; mine: boolean; onPress: () => void }) {
  const { theme } = useLook();
  const counts = new Map<string, number>();
  for (const [, emoji] of list) counts.set(emoji, (counts.get(emoji) ?? 0) + 1);
  const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3);
  return (
    <Animated.View entering={popIn} exiting={popOut} style={{ marginTop: -6, alignSelf: mine ? 'flex-end' : 'flex-start', marginHorizontal: 10 }}>
      <Pressy onPress={onPress} scale={0.9} label={top.map(([e]) => e).join(' ')} testID="reactions">
        <View
          style={{
            minHeight: 26,
            paddingHorizontal: 7,
            borderRadius: 13,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 2,
            backgroundColor: theme.bubbleIn,
            borderWidth: 1,
            borderColor: theme.glassLine,
            boxShadow: theme.dark ? undefined : '0 2px 8px -3px rgba(30,64,140,0.25)',
          }}
        >
          {top.map(([emoji]) => (
            <Text key={emoji} style={{ fontSize: 13 }}>
              {emoji}
            </Text>
          ))}
          {list.length > 1 && (
            <Txt size={12} weight="600" color={theme.muted} style={{ marginStart: 2 }}>
              {list.length}
            </Txt>
          )}
        </View>
      </Pressy>
    </Animated.View>
  );
}

/** The little tail at the top of a run's first bubble, on the sender's side. */
function Tail({ mine, colour }: { mine: boolean; colour: string }) {
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 0,
        ...(mine ? { end: -8 } : { start: -8 }),
        width: 0,
        height: 0,
        borderTopWidth: 11,
        borderTopColor: colour,
        ...(mine ? { borderEndWidth: 8, borderEndColor: 'transparent' } : { borderStartWidth: 8, borderStartColor: 'transparent' }),
      }}
    />
  );
}

/** The name on a quote: the person's own colour in a group, like the names on bubbles. */
function nameColourOrAcc(m: Message, theme: { dark: boolean; accInk: string }) {
  return m.author === core.myId ? theme.accInk : nameColour(m.author, theme.dark);
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
      {/* Grey words, like WhatsApp's (and the floating date pill). */}
      <Txt size={12} weight="600" color={theme.sectionText} align="center">
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
  // The dots bounce one after another, like WhatsApp's (owner, 12 Nov: WhatsApp comparison #8).
  const { theme } = useLook();
  const v = useSharedValue(0);
  useEffect(() => {
    v.set(withDelay(delay, withRepeat(withSequence(withTiming(1, { duration: 280 }), withTiming(0, { duration: 280 }), withTiming(0, { duration: 340 })), -1)));
    return () => cancelAnimation(v);
  }, [v, delay]);
  const style = useAnimatedStyle(() => ({ opacity: 0.45 + 0.55 * v.value, transform: [{ translateY: -3.5 * v.value }] }));
  return <Animated.View style={[{ width: 7, height: 7, borderRadius: 4, backgroundColor: theme.muted }, style]} />;
}

/** Each person's own colour for their name in a group, like WhatsApp's (the same person always gets the same one). */
const NAMES_LIGHT = ['#1F7A4D', '#B5487A', '#2F6FC2', '#B3651E', '#7B4BC4', '#B23C3C', '#1E8A8A', '#8A6D1E', '#5B6FD6', '#C2457A', '#3E8E3E', '#A0522D'];
const NAMES_DARK = ['#53BDEB', '#FC9775', '#A5B337', '#FF72A1', '#7F66FF', '#25D366', '#FFBC38', '#E26AB6', '#42C7B8', '#FA6533', '#C4A3FF', '#06CF9C'];
export function nameColour(id: string, dark: boolean) {
  const list = dark ? NAMES_DARK : NAMES_LIGHT;
  return list[hash(id) % list.length];
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
