// Composer.tsx: where you write a message, laid out like WhatsApp's bar in PakChat's look.
//
//   [ 🙂  Message…           📎  📷 ]  (🎤)
//
// In the box: the sticker button (its panel opens on Stickers, with GIFs and
// emoji), the words, 📎 for the attach menu, and 📷 (tap: the camera; hold: a
// round video). The 📷 hides while you type, as on WhatsApp. The round button
// beside the box is a microphone while the box is empty and turns into "send"
// (with a little spin) as soon as you type; hold "send" to schedule the message.
//
// A web address in the words gets a preview card (links.ts), which goes with
// the message unless you close it. Your words are kept as a draft if you leave,
// and the others see "typing…" while you write.
import type { Chat, ChatQuote, Gif, LinkPreview, Message } from '@pakchat/shared';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, TextInput, View, type TextInputInstance } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated, { FadeIn, FadeOut, FadeOutDown, interpolate, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { core } from '../../core/core';
import { firstUrl, previewOf } from '../../core/links';
import type { Recorded } from '../../core/voice';
import { fill, useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { bodyLine } from '../format';
import { Icon } from '../icons';
import { fontStyle, Glass, IconButton, Pressy, Txt } from '../kit';
import { lively, rise, thud } from '../motion';
import { ExtrasPanel } from './ExtrasPanel';
import { useRoundRecorder, type RoundVideo } from './RoundRecorder';
import { useVoiceRecorder } from './VoiceRecorder';

export function Composer({
  chat,
  replyTo,
  editing,
  quote,
  onCancel,
  onSend,
  onSchedule,
  onAttach,
  onCamera,
  onRound,
  onVoice,
  onGif,
  onSticker,
}: {
  chat: Chat;
  replyTo: Message | null;
  editing: Message | null;
  /** "Reply privately": the group message the next one answers. */
  quote?: ChatQuote | null;
  onCancel: () => void;
  onSend: (text: string, mentions: string[], link?: LinkPreview) => void;
  /** Hold "send", then "Schedule message": the screen asks when. True if it was scheduled (the box empties). */
  onSchedule: (text: string, mentions: string[], link?: LinkPreview) => Promise<boolean>;
  onAttach: () => void;
  /** A tap on the 📷: the camera, to take photos and videos to edit and send. */
  onCamera: () => void;
  /** Holding the 📷 recorded a round video (RoundRecorder.tsx). */
  onRound: (v: RoundVideo) => void;
  /** A voice note was recorded (VoiceRecorder.tsx). */
  onVoice: (v: Recorded) => void;
  /** A GIF or a sticker was picked in the sticker panel (ExtrasPanel.tsx). */
  onGif: (g: Gif) => void;
  onSticker: (from: string | number) => void;
}) {
  const t = useT();
  const { theme, lang, rtl } = useLook();
  // The screen gives the composer a new key when editing starts, so it starts again with the old words.
  const [text, setText] = useState(() => editing?.text ?? core.prefs[chat.id]?.draft ?? '');
  const [mentions, setMentions] = useState<string[]>([]);
  const [panel, setPanel] = useState(false);
  const input = useRef<TextInputInstance>(null);
  const typingSent = useRef(0);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Editing or replying puts the cursor in the box.
  useEffect(() => {
    if (editing || replyTo) setTimeout(() => input.current?.focus(), 60);
  }, [editing, replyTo]);

  // Keep a draft (not while editing: that isn't a new message).
  const latest = useRef(text);
  useEffect(() => {
    latest.current = text;
  }, [text]);
  const saveDraft = (words: string) => {
    if ((core.prefs[chat.id]?.draft ?? '') !== (words.trim() ? words : '')) core.setPrefs(chat.id, { draft: words.trim() ? words : undefined });
  };
  useEffect(() => {
    if (editing) return;
    const id = setTimeout(() => saveDraft(text), 400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, chat.id, editing]);
  // Leaving the chat quickly still keeps what was typed (the wait above may not have finished).
  useEffect(
    () => () => {
      if (!editing) saveDraft(latest.current);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chat.id, editing],
  );

  // Stop "typing…" when leaving the chat.
  useEffect(
    () => () => {
      if (stopTimer.current) clearTimeout(stopTimer.current);
      if (typingSent.current) core.client.typing(chat.id, false);
    },
    [chat.id],
  );

  // ---- The link preview ----
  // The first web address gets a card, a moment after you stop typing. ✕ closes it for that address.
  const url = editing ? null : firstUrl(text);
  const [link, setLink] = useState<LinkPreview | null>(null);
  const [closed, setClosed] = useState<string | null>(null);
  useEffect(() => {
    if (!url || url === closed || !core.settings.linkPreviews || link?.url === url) return;
    let live = true;
    const id = setTimeout(() => {
      void previewOf(url).then((card) => {
        if (live) setLink(card);
      });
    }, 600);
    return () => {
      live = false;
      clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, closed]);
  const card = link && link.url === url && url !== closed ? link : null;

  function changed(next: string) {
    setText(next);
    const now = Date.now();
    if (next.trim() && now - typingSent.current > 3000) {
      typingSent.current = now;
      core.client.typing(chat.id, true);
    }
    if (stopTimer.current) clearTimeout(stopTimer.current);
    stopTimer.current = setTimeout(() => {
      if (typingSent.current) core.client.typing(chat.id, false);
      typingSent.current = 0;
    }, 4000);
  }

  function cleared() {
    setText('');
    // Sent: the draft goes at once, so it can't come back if you leave straight away.
    if (!editing) saveDraft('');
    setMentions([]);
    setLink(null);
    setClosed(null);
    if (typingSent.current) core.client.typing(chat.id, false);
    typingSent.current = 0;
  }

  const ready = () => {
    const clean = text.trim();
    return clean ? { clean, who: mentions.filter((id) => clean.includes(`@${core.plainName(id)}`)) } : null;
  };

  function send() {
    const r = ready();
    if (!r) return;
    onSend(r.clean, r.who, card ?? undefined);
    cleared();
  }

  async function schedule() {
    const r = ready();
    if (!r) return;
    if (await onSchedule(r.clean, r.who, card ?? undefined)) cleared();
  }

  // @mentions in groups: typing "@" shows the members to pick from.
  const at = chat.kind === 'group' ? /(^|\s)@([^\s@]*)$/.exec(text) : null;
  const suggestions = at
    ? chat.members
        .filter((mb) => mb.userId !== core.myId)
        .map((mb) => ({ id: mb.userId, name: core.plainName(mb.userId) }))
        .filter((p) => p.name && p.name.toLowerCase().startsWith(at[2].toLowerCase()))
        .slice(0, 5)
    : [];

  function mention(p: { id: string; name: string }) {
    setText(text.replace(/@([^\s@]*)$/, `@${p.name} `));
    setMentions((old) => [...new Set([...old, p.id])]);
  }

  // The mic turns into "send" with a quarter turn and a pop.
  const hasText = text.trim().length > 0;
  const v = useSharedValue(hasText ? 1 : 0);
  useEffect(() => {
    v.value = withSpring(hasText ? 1 : 0, lively);
  }, [hasText, v]);
  const micStyle = useAnimatedStyle(() => ({ opacity: 1 - v.value, transform: [{ scale: interpolate(v.value, [0, 1], [1, 0.4]) }, { rotate: `${v.value * -90}deg` }] }));
  const sendStyle = useAnimatedStyle(() => ({ opacity: v.value, transform: [{ scale: interpolate(v.value, [0, 1], [0.4, 1]) }, { rotate: `${(1 - v.value) * 90}deg` }] }));

  // Voice notes: the mic button records (hold, slide, lock, or tap).
  const voice = useVoiceRecorder({ enabled: !hasText && !editing, onSend: onVoice });
  const recording = voice.mode !== 'idle';
  const locked = voice.mode === 'locked' || voice.mode === 'paused';
  // Round videos: hold the 📷.
  const round = useRoundRecorder({ enabled: !hasText && !editing && !recording, onTap: () => (Keyboard.dismiss(), setPanel(false), onCamera()), onSend: onRound });

  const banner = editing ?? replyTo;
  const privately = !banner && quote ? quote : null;

  return (
    // No layout animation on this outer view: it moves with the keyboard every frame,
    // and an animation here lagged behind and bounced. The parts inside fade in on their own.
    <Animated.View>
      {round.overlay}

      {suggestions.length > 0 && (
        <Animated.View entering={rise()} exiting={FadeOutDown.duration(120)}>
          <Glass strong style={{ marginHorizontal: 10, marginBottom: 6, paddingVertical: 4, borderRadius: 18 }}>
            {suggestions.map((p) => (
              <Pressy key={p.id} onPress={() => mention(p)} label={p.name} scale={0.98}>
                <View style={{ paddingHorizontal: 16, paddingVertical: 10 }}>
                  <Txt size={15} weight="600" color={theme.accInk}>
                    @{p.name}
                  </Txt>
                </View>
              </Pressy>
            ))}
          </Glass>
        </Animated.View>
      )}

      {voice.lockHint}

      {panel && !recording && (
        <ExtrasPanel
          onEmoji={(e) => changed(text + e)}
          onGif={(g) => {
            setPanel(false);
            onGif(g);
          }}
          onSticker={(from) => {
            setPanel(false);
            onSticker(from);
          }}
        />
      )}

      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginHorizontal: 10, marginTop: 10, marginBottom: 10 }}>
        <Glass style={{ flex: 1, padding: 4, borderRadius: 24 }}>
          {banner && !recording && (
            <Animated.View entering={rise()} exiting={FadeOut.duration(100)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, margin: 2, marginBottom: 4 }}>
              <View style={{ flex: 1, borderStartWidth: 3, borderColor: theme.acc, borderRadius: 14, backgroundColor: theme.accSoft, paddingHorizontal: 10, paddingVertical: 6 }}>
                <Txt size={13} weight="700" color={theme.accInk}>
                  {editing ? t.editing : fill(t.replyingTo, { name: banner.author === core.myId ? t.youWord : core.name(banner.author) || '…' })}
                </Txt>
                <Txt size={13} color={theme.muted} lines={1}>
                  {bodyLine(banner, t)}
                </Txt>
              </View>
              <IconButton
                icon="close"
                label={t.cancel}
                size={36}
                iconSize={18}
                onPress={() => {
                  if (editing) setText('');
                  onCancel();
                }}
                testID="cancel-reply"
              />
            </Animated.View>
          )}
          {privately && !recording && (
            <Animated.View entering={rise()} exiting={FadeOut.duration(100)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, margin: 2, marginBottom: 4 }} testID="private-reply">
              <View style={{ flex: 1, borderStartWidth: 3, borderColor: theme.acc, borderRadius: 14, backgroundColor: theme.accSoft, paddingHorizontal: 10, paddingVertical: 6 }}>
                <Txt size={13} weight="700" color={theme.accInk}>
                  {fill(t.replyingPrivately, { name: core.name(privately.author) || '…' })}
                </Txt>
                <Txt size={13} color={theme.muted} lines={1}>
                  {privately.text ?? t.photoLabel}
                </Txt>
              </View>
              <IconButton icon="close" label={t.cancel} size={36} iconSize={18} onPress={onCancel} testID="cancel-private-reply" />
            </Animated.View>
          )}
          {card && !recording && <LinkCard card={card} onClose={() => setClosed(card.url)} />}
          <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
            {recording ? (
              voice.strip
            ) : (
              <>
                <IconButton
                  icon={panel ? 'keyboard' : 'smile'}
                  label={panel ? t.message : t.stickersEmoji}
                  size={42}
                  iconSize={22}
                  onPress={() => {
                    if (panel) {
                      setPanel(false);
                      input.current?.focus();
                    } else {
                      Keyboard.dismiss();
                      setPanel(true);
                    }
                  }}
                  color={panel ? theme.acc : theme.muted}
                  testID="stickers"
                />
                <TextInput
                  ref={input}
                  testID="composer"
                  value={text}
                  onChangeText={changed}
                  // The keyboard and the sticker panel take turns, as on WhatsApp.
                  onFocus={() => setPanel(false)}
                  placeholder={t.message}
                  placeholderTextColor={theme.muted}
                  selectionColor={theme.acc}
                  cursorColor={theme.acc}
                  multiline
                  maxLength={4000}
                  style={[
                    fontStyle(text || null, lang, 16, '400'),
                    { flex: 1, color: theme.text, maxHeight: 132, minHeight: 42, paddingVertical: 9, paddingHorizontal: 2, textAlign: rtl ? 'right' : 'left', textAlignVertical: 'center' },
                  ]}
                />
                <IconButton icon="attach" label={t.attachFile} size={42} iconSize={21} color={theme.muted} onPress={() => (Keyboard.dismiss(), setPanel(false), onAttach())} testID="attach" />
                {!hasText && !editing && (
                  <Animated.View entering={FadeIn.duration(140)} exiting={FadeOut.duration(90)}>
                    <GestureDetector gesture={round.gesture}>
                      <View
                        accessible
                        accessibilityRole="button"
                        accessibilityLabel={t.openCamera}
                        accessibilityHint={t.holdForRound}
                        onAccessibilityTap={onCamera}
                        testID="camera"
                        style={{ width: 42, height: 42, alignItems: 'center', justifyContent: 'center' }}
                      >
                        <Icon name="camera" size={22} color={round.recording ? theme.acc : theme.muted} />
                      </View>
                    </GestureDetector>
                  </Animated.View>
                )}
              </>
            )}
          </View>
        </Glass>

        {/* The mic records voice notes; it holds your finger, so it stays put while recording. */}
        <View>
          <GestureDetector gesture={voice.gesture}>
            <Animated.View style={voice.micStyle}>
              <Pressy
                onPress={() => (hasText ? send() : undefined)}
                onLongPress={hasText && !editing ? () => (thud(), void schedule()) : undefined}
                label={hasText ? t.send : locked ? t.sendVoice : t.voiceNote}
                testID="send"
                scale={0.88}
              >
                <LinearGradient
                  colors={theme.grad}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{ width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', boxShadow: `0 8px 20px -8px ${theme.acc}` }}
                >
                  <Animated.View style={[{ position: 'absolute' }, micStyle]}>
                    <Icon name={locked ? 'send' : 'mic'} size={21} color="#FFFFFF" stroke={2} flip={locked} />
                  </Animated.View>
                  <Animated.View style={[{ position: 'absolute' }, sendStyle]}>
                    <Icon name={editing ? 'check' : 'send'} size={21} color="#FFFFFF" stroke={2} flip />
                  </Animated.View>
                </LinearGradient>
              </Pressy>
            </Animated.View>
          </GestureDetector>
        </View>
      </View>
    </Animated.View>
  );
}

/** The preview of a web address in the box, before it's sent. */
function LinkCard({ card, onClose }: { card: LinkPreview; onClose: () => void }) {
  const t = useT();
  const { theme } = useLook();
  return (
    <Animated.View entering={rise()} exiting={FadeOut.duration(100)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, margin: 2, marginBottom: 4, padding: 6, borderRadius: 16, backgroundColor: theme.accSoft }} testID="link-card">
      {card.thumb ? (
        <Image source={{ uri: `data:image/jpeg;base64,${card.thumb}` }} style={{ width: 52, height: 52, borderRadius: 11 }} contentFit="cover" />
      ) : (
        <View style={{ width: 52, height: 52, borderRadius: 11, backgroundColor: theme.glass, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="link" size={20} color={theme.accInk} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        {!!card.title && (
          <Txt size={13.5} weight="700" lines={1}>
            {card.title}
          </Txt>
        )}
        {!!card.description && (
          <Txt size={12.5} color={theme.muted} lines={2}>
            {card.description}
          </Txt>
        )}
        <Txt size={11.5} color={theme.accInk} lines={1}>
          {card.site ?? card.url}
        </Txt>
      </View>
      <IconButton icon="close" label={t.close} size={32} iconSize={16} onPress={onClose} testID="link-card-close" />
    </Animated.View>
  );
}
