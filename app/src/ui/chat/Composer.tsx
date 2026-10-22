// Composer.tsx: where you write a message.
//
// The round button on the end is a microphone while the box is empty and turns
// into "send" (with a little spin) as soon as you type. Your words are kept as
// a draft if you leave, and the others see "typing…" while you write.
import type { Chat, Message } from '@pakchat/shared';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, TextInput, View, type TextInputInstance } from 'react-native';
import Animated, { FadeIn, FadeOut, FadeOutDown, interpolate, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { core } from '../../core/core';
import { fill, useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { Icon } from '../icons';
import { fontStyle, Glass, IconButton, Pressy, Txt } from '../kit';
import { lively, rise } from '../motion';
import { toast } from '../overlays';

const EMOJI = ['😂', '❤️', '👍', '🙏', '😍', '😭', '🔥', '😊', '🤲', '💯', '😅', '🥰', '👌', '😢', '🎉', '🤣', '✨', '🌙'];

export function Composer({
  chat,
  replyTo,
  editing,
  quick,
  onCancel,
  onSend,
  onAttach,
}: {
  chat: Chat;
  replyTo: Message | null;
  editing: Message | null;
  /** Show the one-tap answers ("Theek hai", "InshaAllah"…). */
  quick: boolean;
  onCancel: () => void;
  onSend: (text: string, mentions: string[]) => void;
  onAttach: () => void;
}) {
  const t = useT();
  const { theme, lang, rtl } = useLook();
  // The screen gives the composer a new key when editing starts, so it starts again with the old words.
  const [text, setText] = useState(() => editing?.text ?? core.prefs[chat.id]?.draft ?? '');
  const [mentions, setMentions] = useState<string[]>([]);
  const [emoji, setEmoji] = useState(false);
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

  function send(words = text) {
    const clean = words.trim();
    if (!clean) return;
    onSend(clean, mentions.filter((id) => clean.includes(`@${core.name(id)}`)));
    setText('');
    // Sent: the draft goes at once, so it can't come back if you leave straight away.
    if (!editing) saveDraft('');
    setMentions([]);
    if (typingSent.current) core.client.typing(chat.id, false);
    typingSent.current = 0;
  }

  // @mentions in groups: typing "@" shows the members to pick from.
  const at = chat.kind === 'group' ? /(^|\s)@([^\s@]*)$/.exec(text) : null;
  const suggestions = at
    ? chat.members
        .filter((mb) => mb.userId !== core.myId)
        .map((mb) => ({ id: mb.userId, name: core.name(mb.userId) }))
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

  const banner = editing ?? replyTo;
  const quickOnes = [t.quickOk, t.quickInshallah, t.quickSure, t.quickHaha];

  return (
    // No layout animation on this outer view: it moves with the keyboard every frame,
    // and an animation here lagged behind and bounced. The parts inside fade in on their own.
    <Animated.View>
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

      {quick && !hasText && !banner && (
        <Animated.View entering={FadeIn.delay(150)} exiting={FadeOut.duration(100)}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 12, paddingTop: 8 }} keyboardShouldPersistTaps="always">
            {quickOnes.map((q) => (
              <Pressy key={q} onPress={() => send(q)} label={q} scale={0.93} testID={`quick-${q}`}>
                <View style={{ height: 34, paddingHorizontal: 14, borderRadius: 12, backgroundColor: theme.glass, justifyContent: 'center' }}>
                  <Txt size={13} weight="600" color={theme.accInk}>
                    {q}
                  </Txt>
                </View>
              </Pressy>
            ))}
          </ScrollView>
        </Animated.View>
      )}

      {emoji && (
        <Animated.View entering={rise()} exiting={FadeOutDown.duration(120)}>
          <Glass strong style={{ marginHorizontal: 10, marginTop: 8, padding: 6, borderRadius: 20, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' }}>
            {EMOJI.map((e) => (
              <Pressy key={e} onPress={() => changed(text + e)} label={e} scale={0.85}>
                <View style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                  <Txt size={24} align="center">
                    {e}
                  </Txt>
                </View>
              </Pressy>
            ))}
          </Glass>
        </Animated.View>
      )}

      <Glass style={{ marginHorizontal: 10, marginTop: 10, marginBottom: 10, padding: 6, borderRadius: 22 }}>
        {banner && (
          <Animated.View entering={rise()} exiting={FadeOut.duration(100)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <View style={{ flex: 1, borderStartWidth: 3, borderColor: theme.acc, borderRadius: 10, backgroundColor: theme.accSoft, paddingHorizontal: 10, paddingVertical: 6 }}>
              <Txt size={13} weight="700" color={theme.accInk}>
                {editing ? t.editing : fill(t.replyingTo, { name: banner.author === core.myId ? t.youWord : core.name(banner.author) || '…' })}
              </Txt>
              <Txt size={13} color={theme.muted} lines={1}>
                {banner.kind === 'poll' ? `${t.poll} ${banner.poll?.question ?? ''}` : (banner.text ?? '')}
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
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
          <IconButton icon="plus" label={t.attach} look="soft" onPress={onAttach} testID="attach" />
          <TextInput
            ref={input}
            testID="composer"
            value={text}
            onChangeText={changed}
            placeholder={t.message}
            placeholderTextColor={theme.muted}
            selectionColor={theme.acc}
            cursorColor={theme.acc}
            multiline
            maxLength={4000}
            style={[
              fontStyle(text || null, lang, 16, '400'),
              { flex: 1, color: theme.text, maxHeight: 132, minHeight: 44, paddingVertical: 10, textAlign: rtl ? 'right' : 'left', textAlignVertical: 'center' },
            ]}
          />
          <IconButton icon="emoji" label={t.emoji} onPress={() => setEmoji((e) => !e)} color={emoji ? theme.acc : theme.muted} />
          <Pressy
            onPress={() => (hasText ? send() : toast(t.voiceSoon))}
            label={hasText ? t.send : t.voiceNote}
            testID="send"
            scale={0.88}
          >
            <LinearGradient
              colors={theme.grad}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center', boxShadow: `0 8px 20px -8px ${theme.acc}` }}
            >
              <Animated.View style={[{ position: 'absolute' }, micStyle]}>
                <Icon name="mic" size={20} color="#FFFFFF" stroke={2} />
              </Animated.View>
              <Animated.View style={[{ position: 'absolute' }, sendStyle]}>
                <Icon name={editing ? 'check' : 'send'} size={20} color="#FFFFFF" stroke={2} flip />
              </Animated.View>
            </LinearGradient>
          </Pressy>
        </View>
      </Glass>
    </Animated.View>
  );
}
