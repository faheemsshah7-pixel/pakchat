// viewer.tsx: a photo or video on its own, full screen, on black. The video plays
// with the phone's own controls. Share sends the file to another app.
import type { Message } from '@pakchat/shared';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';

import { core } from '../core/core';
import { useT } from '../i18n';
import { clock } from '../ui/format';
import { IconButton, Txt } from '../ui/kit';

export default function Viewer() {
  const { chat, author, id } = useLocalSearchParams<{ chat: string; author: string; id: string }>();
  const t = useT();
  const insets = useSafeAreaInsets();
  const [m, setM] = useState<Message | null>(null);

  useEffect(() => {
    void core.storage.getMessage(chat, author, id).then(setM);
  }, [chat, author, id]);

  const f = m?.file;
  const who = m ? (m.author === core.myId ? t.youWord : core.name(m.author)) : '';

  return (
    <View style={{ flex: 1, backgroundColor: '#000000' }}>
      <StatusBar style="light" />
      {f?.local && f.kind === 'video' ? (
        <Video uri={f.local} />
      ) : f?.local ? (
        <Image source={{ uri: f.local }} style={{ flex: 1 }} contentFit="contain" testID="viewer-image" />
      ) : null}
      <View style={{ position: 'absolute', top: insets.top + 6, start: 8, end: 8, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <IconButton icon="back" label={t.back} onPress={() => router.back()} flip look="onAccent" size={42} testID="viewer-back" />
        <View style={{ flex: 1 }}>
          <Txt size={16} weight="700" color="#FFFFFF" lines={1}>
            {who}
          </Txt>
          {!!m && (
            <Txt size={12.5} color="rgba(255,255,255,0.75)">
              {clock(m.sentAt)}
            </Txt>
          )}
        </View>
        {!!f?.local && (
          <IconButton icon="forward" label={t.forward} look="onAccent" size={42} flip onPress={() => void Sharing.shareAsync(f.local!, { mimeType: f.mime }).catch(() => {})} />
        )}
      </View>
      {!!m?.text && (
        <View style={{ position: 'absolute', start: 0, end: 0, bottom: 0, padding: 16, paddingBottom: insets.bottom + 16, backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <Txt size={15} color="#FFFFFF">
            {m.text}
          </Txt>
        </View>
      )}
    </View>
  );
}

function Video({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => p.play());
  return <VideoView player={player} style={{ flex: 1 }} nativeControls contentFit="contain" testID="viewer-video" />;
}
