// FileBody.tsx: a photo, video or document inside a message bubble.
//
// Before it downloads, a photo or video shows its tiny blurred preview with a
// download button and its size; while moving, how far it's got; once here, the
// photo itself (or the video's first frame and a play button). A document is a
// row with its name and size. Tap to download, or to open once it's here.
import type { Message } from '@pakchat/shared';
import { File } from 'expo-file-system';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { View } from 'react-native';

import { useFileProgress } from '../../core/hooks';
import { download, FileBroken, FileGone, haveFile, tagOf } from '../../core/files';
import { isOffline } from '../../core/core';
import { useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { duration, fileSize } from '../format';
import { Icon } from '../icons';
import { Pressy, Txt } from '../kit';
import { toast } from '../overlays';

const WIDE = 236;

export function FileBody({ m, mine, selecting, onPick }: { m: Message; mine: boolean; selecting: boolean; onPick: () => void }) {
  const t = useT();
  const { theme } = useLook();
  const f = m.file!;
  const progress = useFileProgress(tagOf(m.chatId, m));
  const here = haveFile(m);
  const sending = mine && m.status === 'queued';
  const ink = mine ? theme.bubbleMineText : theme.text;
  const meta = mine ? (theme.dark ? 'rgba(236,238,242,0.7)' : theme.sectionText) : theme.muted;

  async function tap() {
    if (selecting) return onPick();
    if (here) return open(m);
    if (progress !== undefined || sending) return;
    try {
      await download(m);
    } catch (err) {
      toast(err instanceof FileGone ? t.fileGone : err instanceof FileBroken ? t.fileBroken : isOffline(err) ? t.offline : t.couldNot);
    }
  }

  // What sits over a photo or video, or at the end of a document's row.
  const badge =
    progress !== undefined ? (
      <Txt size={13} weight="700" color="#FFFFFF" testID="file-progress">
        {Math.round(progress * 100)}%
      </Txt>
    ) : sending ? (
      <Icon name="upload" size={22} color="#FFFFFF" />
    ) : !here ? (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Icon name="download" size={18} color="#FFFFFF" />
        <Txt size={12.5} weight="700" color="#FFFFFF">
          {fileSize(f.size)}
        </Txt>
      </View>
    ) : f.kind === 'video' ? (
      <Icon name="play" size={24} color="#FFFFFF" />
    ) : null;

  if (f.kind === 'image' || f.kind === 'video') {
    const ratio = f.width && f.height ? f.height / f.width : 0.75;
    const height = Math.round(Math.min(320, Math.max(130, WIDE * ratio)));
    const source = here && f.kind === 'image' ? { uri: f.local } : f.thumb ? { uri: `data:image/jpeg;base64,${f.thumb}` } : null;
    return (
      <Pressy onPress={tap} onLongPress={onPick} label={f.kind === 'image' ? t.photoLabel : t.videoLabel} scale={0.98} testID={`file-${f.kind}`}>
        <View style={{ width: WIDE, height, borderRadius: 14, overflow: 'hidden', backgroundColor: theme.glass, marginBottom: 4 }}>
          {source && <Image source={source} style={{ width: '100%', height: '100%' }} contentFit="cover" blurRadius={here && f.kind === 'image' ? 0 : 6} transition={150} />}
          {badge && (
            <View style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ minWidth: 52, height: 52, paddingHorizontal: 12, borderRadius: 26, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' }}>{badge}</View>
            </View>
          )}
          {f.kind === 'video' && !!f.duration && (
            <View style={{ position: 'absolute', start: 8, bottom: 6, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Icon name="video" size={14} color="#FFFFFF" />
              <Txt size={11.5} weight="600" color="#FFFFFF">
                {duration(f.duration)}
              </Txt>
            </View>
          )}
        </View>
      </Pressy>
    );
  }

  return (
    <Pressy onPress={tap} onLongPress={onPick} label={f.name ?? t.document} scale={0.98} testID="file-doc">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8, borderRadius: 12, backgroundColor: mine ? 'rgba(255,255,255,0.16)' : theme.glass, minWidth: 220, marginBottom: 4 }}>
        <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: theme.accSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={f.kind === 'audio' || f.kind === 'voice' ? 'music' : 'doc'} size={21} color={theme.accInk} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt size={14.5} weight="600" color={ink} lines={2}>
            {f.name ?? t.document}
          </Txt>
          <Txt size={12} color={meta}>
            {[fileSize(f.size), (/\.([a-z0-9]+)$/i.exec(f.name ?? '')?.[1] ?? '').toUpperCase()].filter(Boolean).join(' · ')}
          </Txt>
        </View>
        {badge && (
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' }}>
            {progress !== undefined ? badge : <Icon name={sending ? 'upload' : 'download'} size={19} color="#FFFFFF" />}
          </View>
        )}
      </View>
    </Pressy>
  );
}

/** Opens a file that's here: photos and videos in PakChat's viewer, documents in another app. */
export async function open(m: Message) {
  const f = m.file;
  if (!f?.local) return;
  if (f.kind === 'image' || f.kind === 'video') {
    router.push({ pathname: '/viewer', params: { chat: m.chatId, author: m.author, id: m.id } });
    return;
  }
  try {
    await new File(f.local).preview({ mimeType: f.mime });
  } catch {
    // No app opens this kind of file: offer to send it somewhere instead.
    await Sharing.shareAsync(f.local, { mimeType: f.mime, dialogTitle: f.name }).catch(() => {});
  }
}
