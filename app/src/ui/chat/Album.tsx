// Album.tsx: photos and videos sent together, as one square of four in the
// chat, like WhatsApp (albums.ts says which). The fourth shows "+N" for the
// rest; tap it for the album page with all of them (app/album.tsx). Tap any
// other to see it (or download it first).
import type { Message } from '@pakchat/shared';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { View } from 'react-native';

import { useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { duration, fileSize } from '../format';
import { Icon } from '../icons';
import { Pressy, Txt } from '../kit';
import { Stop, useFileTap } from './FileBody';

const WIDE = 236;
const GAP = 3;

/** The album page for these messages. */
export function openAlbum(ms: Message[]) {
  router.push({ pathname: '/album', params: { chat: ms[0].chatId, keys: JSON.stringify(ms.map((m) => `${m.author}/${m.id}`)) } });
}

export function AlbumBody({ ms, mine, selecting, onPick }: { ms: Message[]; mine: boolean; selecting: boolean; onPick: () => void }) {
  const size = (WIDE - GAP) / 2;
  const shown = ms.slice(0, 4);
  const rest = ms.length - 3;
  return (
    <View style={{ width: WIDE, flexDirection: 'row', flexWrap: 'wrap', gap: GAP, marginBottom: 4 }} testID="album">
      {shown.map((m, i) => (
        <AlbumTile
          key={`${m.author}/${m.id}`}
          m={m}
          mine={mine}
          size={size}
          radius={10}
          selecting={selecting}
          onPick={onPick}
          more={i === 3 && ms.length > 4 ? rest : 0}
          onMore={() => (selecting ? onPick() : openAlbum(ms))}
        />
      ))}
    </View>
  );
}

/** One photo or video, square: its picture, and what to tap (download, stop, play). */
export function AlbumTile({
  m,
  mine,
  size,
  radius = 0,
  selecting,
  onPick,
  more = 0,
  onMore,
}: {
  m: Message;
  mine: boolean;
  size: number;
  radius?: number;
  selecting: boolean;
  onPick: () => void;
  /** "+N" over it: tapping opens the album instead. */
  more?: number;
  onMore?: () => void;
}) {
  const t = useT();
  const { theme } = useLook();
  const f = m.file!;
  const { tap, progress, here, paused, moving, spot } = useFileTap(m, mine, selecting, onPick);
  const sharp = f.kind === 'video' && !!f.poster;
  const source = here && f.kind === 'image' ? { uri: f.local } : sharp ? { uri: f.poster } : f.thumb ? { uri: `data:image/jpeg;base64,${f.thumb}` } : null;
  const badge = moving ? (
    <Stop progress={progress ?? 0} size={40} label={t.cancel} />
  ) : paused ? (
    <Icon name="upload" size={18} color="#FFFFFF" />
  ) : !here ? (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
      <Icon name="download" size={16} color="#FFFFFF" />
      <Txt size={11} weight="700" color="#FFFFFF">
        {fileSize(f.size)}
      </Txt>
    </View>
  ) : f.kind === 'video' ? (
    <Icon name="play" size={20} color="#FFFFFF" />
  ) : null;

  return (
    <Pressy
      onPress={more > 0 && onMore ? onMore : () => void tap()}
      onLongPress={onPick}
      label={f.kind === 'image' ? t.photoLabel : t.videoLabel}
      scale={0.97}
      testID={more > 0 ? 'album-more' : 'album-tile'}
    >
      <View ref={spot} collapsable={false} style={{ width: size, height: size, borderRadius: radius, overflow: 'hidden', backgroundColor: theme.glass }}>
        {source && (
          <Image source={source} style={{ width: '100%', height: '100%' }} contentFit="cover" blurRadius={(here && f.kind === 'image') || sharp ? 0 : 6} recyclingKey={m.id} />
        )}
        {more > 0 ? (
          <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' }}>
            <Txt size={26} weight="700" color="#FFFFFF">
              +{more}
            </Txt>
          </View>
        ) : (
          badge && (
            <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ minWidth: 40, height: 40, paddingHorizontal: 9, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' }}>{badge}</View>
            </View>
          )
        )}
        {more === 0 && f.kind === 'video' && !!f.duration && (
          <View style={{ position: 'absolute', start: 6, bottom: 4, flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <Icon name="video" size={12} color="#FFFFFF" />
            <Txt size={10.5} weight="600" color="#FFFFFF">
              {duration(f.duration)}
            </Txt>
          </View>
        )}
      </View>
    </Pressy>
  );
}
