// status-new.tsx: a new status update.
//
// Words: type on a colour (tap the palette for the next colour), then send.
// Photos and videos, like WhatsApp's: PakChat's camera opens with your newest
// photos under it (swipe up for the whole gallery); pick one or several, and
// each goes through the same editor as in a chat (crop and turn, drawing,
// words, stickers, a caption, trimming a video) and becomes its own status.
// A video is up to a minute. It goes to the people in Settings › Status
// privacy, locked, for 24 hours.
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { core, isOffline } from '../core/core';
import { loadLimits, sendPicked, TooBig, type Picked } from '../core/files';
import { readyMyStatus, STATUS_BG, STATUS_VIDEO_MAX_MS } from '../core/status';
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
          to={t.myStatus}
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
  const [sending, setSending] = useState(false);

  async function send() {
    if (sending) return;
    const words = text.trim();
    if (!words) return;
    setSending(true);
    try {
      const chat = await readyMyStatus();
      await core.client.sendText(chat.id, words, { bg });
      tick();
      router.back();
    } catch (err) {
      setSending(false);
      toast(isOffline(err) ? t.offline : t.couldNot);
    }
  }

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: STATUS_BG[bg] }}>
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
          style={[fontStyle(text || null, lang, text.length > 120 ? 24 : 32, '700'), { color: '#FFFFFF', textAlign: 'center' }]}
          testID="status-words"
        />
      </View>
      <View style={{ position: 'absolute', top: insets.top + 8, start: 8, end: 8, flexDirection: 'row', alignItems: 'center' }}>
        <IconButton icon="close" label={t.cancel} onPress={() => router.back()} color="#FFFFFF" testID="status-cancel" />
        <View style={{ flex: 1 }} />
        <IconButton icon="palette" label={t.statusColour} onPress={() => setBg((b) => (b + 1) % STATUS_BG.length)} color="#FFFFFF" testID="status-colour" />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10, padding: 12, paddingBottom: insets.bottom + 12 }}>
        <View style={{ flex: 1 }}>
          <Txt size={12.5} color="rgba(255,255,255,0.8)">
            {t.statusFor24}
          </Txt>
        </View>
        <Pressy onPress={() => void send()} label={t.send} scale={0.9} disabled={sending || !text.trim()} testID="status-send">
          <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', opacity: sending || !text.trim() ? 0.5 : 1 }}>
            <Icon name="send" size={22} color={STATUS_BG[bg]} stroke={2} flip />
          </View>
        </Pressy>
      </View>
    </KeyboardAvoidingView>
  );
}
