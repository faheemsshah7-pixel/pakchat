// status-new.tsx: a new status update.
//
// Words: type on a colour (pick one in the row of colours, or tap the palette for
// the next; T for the next font), then send. With nothing typed, the mic records a voice status instead
// (up to 30 seconds): ✕ throws it away, ➤ sends it.
// Photos and videos, like WhatsApp's: PakChat's camera opens with your newest
// photos under it (swipe up for the whole gallery); pick one or several, and
// each goes through the same editor as in a chat (crop and turn, drawing,
// words, stickers, a caption, trimming a video) and becomes its own status.
// A video is up to a minute. It goes to the people in Settings › Status
// privacy, locked, for 24 hours.
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useAudioRecorder } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { core, isOffline } from '../core/core';
import { loadLimits, sendPicked, TooBig, type Picked } from '../core/files';
import { audienceLabel, readyMyStatus, STATUS_BG, STATUS_FONTS, STATUS_VIDEO_MAX_MS, STATUS_VOICE_MAX_MS } from '../core/status';
import { sendVoice, VOICE_OPTIONS, VoiceSession } from '../core/voice';
import { stopAll } from '../core/player';
import { duration } from '../ui/format';
import { fill, useT } from '../i18n';
import { fromGallery } from '../ui/chat/attachments';
import { CameraSheet } from '../ui/chat/CameraSheet';
import { MediaComposer, type Ready } from '../ui/chat/MediaComposer';
import { Icon } from '../ui/icons';
import { fontStyle, IconButton, Pressy, Txt } from '../ui/kit';
import { tick } from '../ui/motion';
import { toast } from '../ui/overlays';
import { useLook } from '../theme/ThemeProvider';

export default function NewStatus() {
  const { kind } = useLocalSearchParams<{ kind?: string }>();
  return kind === 'media' ? <MediaStatus /> : <WordsStatus />;
}

/** Photos and videos: the camera (with the gallery), then the editor. */
function MediaStatus() {
  const t = useT();
  const [picked, setPicked] = useState<Picked[] | null>(null);

  /** What's picked, without anything too big to send. */
  async function keep(from: () => Promise<(Picked | null)[]>) {
    try {
      const got = (await from()).filter((p): p is Picked => !!p);
      if (!got.length) return [];
      const limit = await loadLimits();
      // A video over the limit can still go once it's made smaller.
      const ok = got.filter((p) => !p.size || p.size <= limit || (p.kind === 'video' && !p.gif));
      if (ok.length < got.length) toast(fill(t.fileTooBig, { mb: Math.floor(limit / 1024 / 1024) }));
      return ok;
    } catch {
      toast(t.couldNot);
      return [];
    }
  }

  function send(list: Ready[]) {
    router.back();
    if (list.some((p) => p.kind === 'video' && !p.gif && !p.hd)) toast(t.videoGettingReady);
    // Each one its own status, in the order picked.
    void (async () => {
      try {
        const chat = await readyMyStatus();
        for (const p of list) {
          const { caption, ...one } = p;
          try {
            await sendPicked(chat.id, one, caption);
          } catch (err) {
            if (err instanceof TooBig) toast(fill(t.fileTooBig, { mb: Math.floor(Number(err.message) / 1024 / 1024) }));
            else throw err;
          }
        }
        tick();
      } catch (err) {
        toast(isOffline(err) ? t.offline : t.couldNot);
      }
    })();
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000000' }} testID="status-media-new">
      <CameraSheet
        visible={!picked}
        onClose={() => router.back()}
        onTaken={(list) => setPicked(list)}
        onGallery={() =>
          void keep(fromGallery).then((list) => {
            if (list.length) setPicked(list);
          })
        }
      />
      {picked && (
        <MediaComposer
          items={picked}
          to={audienceLabel(t)}
          maxVideoMs={STATUS_VIDEO_MAX_MS}
          noOnce
          onClose={() => setPicked(null)}
          onMore={() => keep(fromGallery)}
          onSend={send}
        />
      )}
    </View>
  );
}

/** Words on a colour. */
function WordsStatus() {
  const t = useT();
  const { lang } = useLook();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [bg, setBg] = useState(() => Math.floor(Math.random() * STATUS_BG.length));
  const [font, setFont] = useState(0);
  const [sending, setSending] = useState(false);
  // Who will see it, said at the bottom (a tap changes it; back here, it says the new one).
  const [who, setWho] = useState(() => audienceLabel(t));
  useFocusEffect(useCallback(() => setWho(audienceLabel(t)), [t]));

  // A voice status: recording (the clock runs), or stopped at 30 seconds waiting for ➤.
  const rec = useAudioRecorder(VOICE_OPTIONS);
  const session = useRef<VoiceSession | null>(null);
  const [voice, setVoice] = useState<'off' | 'recording' | 'stopped'>('off');
  const [ms, setMs] = useState(0);
  useEffect(() => {
    if (voice !== 'recording') return;
    const id = setInterval(() => {
      const s = session.current;
      if (!s) return;
      const now = s.sample();
      setMs(now);
      if (now >= STATUS_VOICE_MAX_MS) {
        setVoice('stopped');
        void s.pause();
      }
    }, 100);
    return () => clearInterval(id);
  }, [voice]);
  // Leaving throws an unsent recording away.
  useEffect(
    () => () => {
      void session.current?.discard();
      session.current = null;
    },
    [],
  );

  async function startVoice() {
    if (session.current) return;
    if (!(await VoiceSession.allowed())) return toast(t.micNeeded);
    stopAll();
    const s = new VoiceSession(rec);
    session.current = s;
    setMs(0);
    setVoice('recording');
    try {
      await s.record();
    } catch {
      session.current = null;
      setVoice('off');
      toast(t.couldNot);
    }
  }

  function dropVoice() {
    void session.current?.discard();
    session.current = null;
    setVoice('off');
    setMs(0);
  }

  async function sendVoiceStatus() {
    const s = session.current;
    if (!s || sending) return;
    setSending(true);
    try {
      const v = await s.finish(1_000);
      session.current = null;
      if (!v) {
        setSending(false);
        setVoice('off');
        return toast(t.holdToRecord);
      }
      const chat = await readyMyStatus();
      await sendVoice(chat.id, { ...v, duration: Math.min(v.duration, STATUS_VOICE_MAX_MS) });
      tick();
      router.back();
    } catch (err) {
      setSending(false);
      setVoice('off');
      toast(isOffline(err) ? t.offline : t.couldNot);
    }
  }

  async function send() {
    if (sending) return;
    const words = text.trim();
    if (!words) return;
    setSending(true);
    try {
      const chat = await readyMyStatus();
      await core.client.sendText(chat.id, words, { bg, font });
      tick();
      router.back();
    } catch (err) {
      setSending(false);
      toast(isOffline(err) ? t.offline : t.couldNot);
    }
  }

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: STATUS_BG[bg] }}>
      {voice !== 'off' ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18 }} testID="status-voice">
          <View style={{ width: 120, height: 120, borderRadius: 60, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="mic" size={52} color="#FFFFFF" />
          </View>
          <Txt size={30} weight="700" color="#FFFFFF">
            {`${duration(ms)} / ${duration(STATUS_VOICE_MAX_MS)}`}
          </Txt>
          {voice === 'recording' && (
            <View style={{ width: 220, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden' }}>
              <View style={{ width: `${Math.min(100, (ms / STATUS_VOICE_MAX_MS) * 100)}%`, height: 6, backgroundColor: '#FFFFFF' }} />
            </View>
          )}
        </View>
      ) : (
      <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 26 }}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={t.typeStatus}
          placeholderTextColor="rgba(255,255,255,0.65)"
          multiline
          autoFocus
          maxLength={700}
          cursorColor="#FFFFFF"
          selectionColor="rgba(255,255,255,0.5)"
          style={[fontStyle(text || null, lang, text.length > 120 ? 24 : 32, '700'), { color: '#FFFFFF', textAlign: 'center' }, font ? STATUS_FONTS[font] : null]}
          testID="status-words"
        />
      </View>
      )}
      <View style={{ position: 'absolute', top: insets.top + 8, start: 8, end: 8, flexDirection: 'row', alignItems: 'center' }}>
        <IconButton icon="close" label={t.cancel} onPress={() => router.back()} color="#FFFFFF" testID="status-cancel" />
        <View style={{ flex: 1 }} />
        {/* Like WhatsApp's T: the next font. */}
        <Pressy ripple="light" onPress={() => setFont((f) => (f + 1) % STATUS_FONTS.length)} label={t.statusFont} round testID="status-font">
          <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(0,0,0,0.18)', alignItems: 'center', justifyContent: 'center' }}>
            <Txt size={22} weight="700" color="#FFFFFF" style={font ? STATUS_FONTS[font] : undefined}>
              T
            </Txt>
          </View>
        </Pressy>
        {/* Like WhatsApp's palette: the next colour (or pick one in the row below). */}
        <Pressy ripple="light" onPress={() => setBg((b) => (b + 1) % STATUS_BG.length)} label={t.statusColour} round testID="status-colour" style={{ marginStart: 8 }}>
          <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(0,0,0,0.18)', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="palette" size={21} color="#FFFFFF" />
          </View>
        </Pressy>
      </View>
      {/* Every colour in one row, the one in use ringed in white (a calmer pick than tapping round them all). */}
      {voice === 'off' && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ position: 'absolute', top: insets.top + 60, start: 0, end: 0 }}
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 4 }}
          keyboardShouldPersistTaps="always"
          testID="status-colours"
        >
          {STATUS_BG.map((c, i) => (
            <Pressy key={c} ripple="none" onPress={() => setBg(i)} label={t.statusColour} hitSlop={4} testID={`status-colour-${i}`} style={{ borderRadius: 13 }}>
              <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: c, borderWidth: 2, borderColor: i === bg ? '#FFFFFF' : 'rgba(255,255,255,0.35)' }} />
            </Pressy>
          ))}
        </ScrollView>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10, padding: 12, paddingBottom: insets.bottom + 12 }}>
        <View style={{ flex: 1, alignItems: 'flex-start' }}>
          <Pressy ripple="light" onPress={() => router.push('/settings/status-privacy')} label={who} testID="status-audience">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.25)' }}>
              <Icon name="lock" size={14} color="#FFFFFF" />
              <Txt size={13} weight="600" color="#FFFFFF" lines={1}>
                {who}
              </Txt>
            </View>
          </Pressy>
        </View>
        {voice !== 'off' && <IconButton icon="trash" label={t.delete} onPress={dropVoice} color="#FFFFFF" disabled={sending} testID="status-voice-drop" />}
        {voice === 'off' && !text.trim() ? (
          <Pressy ripple="light" onPress={() => void startVoice()} label={t.voiceStatus} scale={0.9} testID="status-mic">
            <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="mic" size={23} color={STATUS_BG[bg]} />
            </View>
          </Pressy>
        ) : (
          <Pressy ripple="light" onPress={() => void (voice !== 'off' ? sendVoiceStatus() : send())} label={t.send} scale={0.9} disabled={sending || (voice === 'off' && !text.trim())} testID="status-send">
            <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', opacity: sending ? 0.5 : 1 }}>
              <Icon name="send" size={22} color={STATUS_BG[bg]} stroke={2} flip />
            </View>
          </Pressy>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
