// status-new.tsx: a new status update.
//
// Words: type on a colour (tap the palette for the next colour), then send.
// A photo or video: pick one (or take one), add a caption, then send. It goes
// to the people in Settings › Status privacy, locked, for 24 hours.
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { core, isOffline } from '../core/core';
import { loadLimits, sendPicked, type Picked } from '../core/files';
import { readyMyStatus, STATUS_BG } from '../core/status';
import { fill, useT } from '../i18n';
import { fromCamera, fromGallery } from '../ui/chat/attachments';
import { Icon } from '../ui/icons';
import { fontStyle, IconButton, Pressy, Txt } from '../ui/kit';
import { tick } from '../ui/motion';
import { toast } from '../ui/overlays';
import { useLook } from '../theme/ThemeProvider';

export default function NewStatus() {
  const t = useT();
  const { lang } = useLook();
  const insets = useSafeAreaInsets();
  const { kind } = useLocalSearchParams<{ kind?: string }>();
  const [text, setText] = useState('');
  const [bg, setBg] = useState(() => Math.floor(Math.random() * STATUS_BG.length));
  const [picked, setPicked] = useState<Picked | null>(null);
  const [sending, setSending] = useState(false);
  const media = kind === 'media';

  // A photo or video: the gallery opens at once.
  useEffect(() => {
    if (!media) return;
    void pick('gallery');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media]);

  async function pick(from: 'gallery' | 'camera') {
    try {
      const p = from === 'camera' ? await fromCamera() : (await fromGallery(false))[0];
      if (p) {
        const limit = await loadLimits();
        if (p.size && p.size > limit) return toast(fill(t.fileTooBig, { mb: Math.floor(limit / 1024 / 1024) }));
        setPicked(p);
      } else if (!picked) router.back();
    } catch {
      toast(t.couldNot);
    }
  }

  async function send() {
    if (sending) return;
    const words = text.trim();
    if (!media && !words) return;
    if (media && !picked) return;
    setSending(true);
    try {
      const chat = await readyMyStatus();
      if (media && picked) await sendPicked(chat.id, picked, words || undefined);
      else await core.client.sendText(chat.id, words, { bg });
      tick();
      router.back();
    } catch (err) {
      setSending(false);
      toast(isOffline(err) ? t.offline : t.couldNot);
    }
  }

  const top = (
    <View style={{ position: 'absolute', top: insets.top + 8, start: 8, end: 8, flexDirection: 'row', alignItems: 'center' }}>
      <IconButton icon="close" label={t.cancel} onPress={() => router.back()} color="#FFFFFF" testID="status-cancel" />
      <View style={{ flex: 1 }} />
      {!media && <IconButton icon="palette" label={t.statusColour} onPress={() => setBg((b) => (b + 1) % STATUS_BG.length)} color="#FFFFFF" testID="status-colour" />}
      {media && <IconButton icon="photo" label={t.photoStatus} onPress={() => void pick('gallery')} color="#FFFFFF" />}
      {media && <IconButton icon="camera" label={t.camera} onPress={() => void pick('camera')} color="#FFFFFF" />}
    </View>
  );

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: media ? '#000000' : STATUS_BG[bg] }}>
      {media ? (
        <View style={{ flex: 1, justifyContent: 'center' }}>{picked && (picked.kind === 'video' ? <VideoPreview uri={picked.uri} /> : <Image source={{ uri: picked.uri }} style={{ flex: 1 }} contentFit="contain" />)}</View>
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
            style={[fontStyle(text || null, lang, text.length > 120 ? 24 : 32, '700'), { color: '#FFFFFF', textAlign: 'center' }]}
            testID="status-words"
          />
        </View>
      )}
      {top}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10, padding: 12, paddingBottom: insets.bottom + 12 }}>
        {media ? (
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={t.addCaption}
            placeholderTextColor="rgba(255,255,255,0.6)"
            multiline
            maxLength={700}
            style={[fontStyle(text || null, lang, 16, '400'), { flex: 1, color: '#FFFFFF', backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, maxHeight: 120 }]}
            testID="status-caption"
          />
        ) : (
          <View style={{ flex: 1 }}>
            <Txt size={12.5} color="rgba(255,255,255,0.8)">
              {t.statusFor24}
            </Txt>
          </View>
        )}
        <Pressy onPress={() => void send()} label={t.send} scale={0.9} disabled={sending || (media ? !picked : !text.trim())} testID="status-send">
          <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', opacity: sending || (media ? !picked : !text.trim()) ? 0.5 : 1 }}>
            <Icon name="send" size={22} color={media ? '#000000' : STATUS_BG[bg]} stroke={2} flip />
          </View>
        </Pressy>
      </View>
    </KeyboardAvoidingView>
  );
}

function VideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer({ uri }, (p) => {
    p.loop = true;
    p.play();
  });
  return <VideoView player={player} style={{ flex: 1 }} contentFit="contain" nativeControls={false} />;
}
