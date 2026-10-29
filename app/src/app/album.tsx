// album.tsx: an album's page, like WhatsApp's: every photo and video that were
// sent together (the "+N" in the chat, ui/chat/Album.tsx), in a grid. Tap one to
// see it, or to download it; "Download all" fetches the rest.
import type { Message } from '@pakchat/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, useWindowDimensions, View } from 'react-native';

import { core } from '../core/core';
import { download, haveFile } from '../core/files';
import { fill, useT } from '../i18n';
import { AlbumTile } from '../ui/chat/Album';
import { listTime } from '../ui/format';
import { IconButton, Screen, TopBar } from '../ui/kit';

const COLS = 3;

export default function Album() {
  const t = useT();
  const { chat, keys } = useLocalSearchParams<{ chat: string; keys: string }>();
  const { width } = useWindowDimensions();
  const [list, setList] = useState<Message[]>([]);

  useEffect(() => {
    const refs = (JSON.parse(keys ?? '[]') as string[]).map((k) => k.split('/') as [string, string]);
    const load = () => void Promise.all(refs.map(([author, id]) => core.storage.getMessage(chat, author, id))).then((all) => setList(all.filter((m): m is Message => !!m && !m.deleted && !!m.file)));
    load();
    return core.on(`messages:${chat}`, load);
  }, [chat, keys]);

  const size = Math.floor((width - 4 - (COLS - 1) * 3) / COLS);
  const missing = list.filter((m) => !haveFile(m));
  const who = list[0] ? (list[0].author === core.myId ? t.youWord : core.name(list[0].author)) : '';
  const photos = list.filter((m) => m.file?.kind === 'image').length;

  return (
    <Screen>
      <TopBar
        title={who}
        subtitle={list.length ? `${fill(t.albumCount, { photos, videos: list.length - photos })} · ${listTime(list.at(-1)!.sentAt, t)}` : undefined}
        onBack={() => router.back()}
        right={
          missing.length > 0 ? (
            <IconButton
              icon="download"
              label={t.downloadAll}
              onPress={() => {
                // One after another, so the phone isn't fetching them all at once.
                void (async () => {
                  for (const m of missing) await download(m).catch(() => {});
                })();
              }}
              testID="album-download-all"
            />
          ) : undefined
        }
      />
      <FlatList
        data={list}
        keyExtractor={(m) => `${m.author}/${m.id}`}
        numColumns={COLS}
        columnWrapperStyle={{ gap: 3 }}
        contentContainerStyle={{ gap: 3, paddingHorizontal: 2, paddingBottom: 30 }}
        renderItem={({ item }) => (
          <View>
            <AlbumTile m={item} mine={item.author === core.myId} size={size} selecting={false} onPick={() => {}} />
          </View>
        )}
      />
    </Screen>
  );
}
