// FileBody.tsx: a photo, video or document inside a message bubble.
//
// Before it downloads, a photo or video shows its tiny blurred preview with a
// download button and its size; while moving, how far it's got; once here, the
// photo itself (or the video's first frame and a play button). A document is a
// row with its name and size. Tap to download, or to open once it's here.
// While it moves, a ring fills up around a ✕, like WhatsApp: tap to stop it.
// A file I stopped while sending stays in the chat, paused, with an upload
// button to send it again (delete it from the message menu to take it back).
// A GIF plays by itself, on a loop, with no sound. A sticker is just the
// picture, big, with no bubble round it (Bubble.tsx).
import type { Message } from '@pakchat/shared';
import { File } from 'expo-file-system';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useVideoPlayer, VideoView } from 'expo-video';
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { useFileProgress } from '../../core/hooks';
import { Cancelled, cancelDownload, download, FileBroken, FileGone, haveFile, pauseSend, resumeSend, tagOf } from '../../core/files';
import { isOffline } from '../../core/core';
import { outsideFor } from '../../core/lock';
import { useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { duration, fileSize } from '../format';
import { Icon } from '../icons';
import { Pressy, Txt } from '../kit';
import { toast } from '../overlays';

const WIDE = 236;
/** How big a sticker shows. */
export const STICKER_SHOWN = 150;

export function FileBody({ m, mine, selecting, onPick }: { m: Message; mine: boolean; selecting: boolean; onPick: () => void }) {
  const t = useT();
  const { theme } = useLook();
  const f = m.file!;
  const progress = useFileProgress(tagOf(m.chatId, m));
  const here = haveFile(m);
  const sending = mine && m.status === 'queued';
  const paused = mine && m.status === 'paused';
  const ink = mine ? theme.bubbleMineText : theme.text;
  const meta = mine ? (theme.dark ? 'rgba(236,238,242,0.7)' : theme.sectionText) : theme.muted;

  async function tap() {
    if (selecting) return onPick();
    // The upload button: send it again.
    if (paused) return void resumeSend(m).catch(() => {});
    if (here && !sending) return open(m);
    // The ✕: stop it.
    if (sending) return void pauseSend(m).catch(() => {});
    if (progress !== undefined) return cancelDownload(m);
    try {
      await download(m);
    } catch (err) {
      if (err instanceof Cancelled) return;
      toast(err instanceof FileGone ? t.fileGone : err instanceof FileBroken ? t.fileBroken : isOffline(err) ? t.offline : t.couldNot);
    }
  }

  // What sits over a photo or video, or at the end of a document's row.
  const moving = progress !== undefined || sending;
  const badge = moving ? (
    <Stop progress={progress ?? 0} size={52} label={t.cancel} />
  ) : paused ? (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }} accessibilityLabel={t.sendAgain} testID="file-paused">
      <Icon name="upload" size={18} color="#FFFFFF" />
      <Txt size={12.5} weight="700" color="#FFFFFF">
        {fileSize(f.size)}
      </Txt>
    </View>
  ) : !here ? (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Icon name="download" size={18} color="#FFFFFF" />
      <Txt size={12.5} weight="700" color="#FFFFFF">
        {fileSize(f.size)}
      </Txt>
    </View>
  ) : f.kind === 'video' && !f.gif ? (
    <Icon name="play" size={24} color="#FFFFFF" />
  ) : null;

  if (f.kind === 'sticker') {
    // Here: only the picture (a tap or hold goes to the message, as on WhatsApp).
    if (here && !moving && !paused) return <Image source={{ uri: f.local }} style={{ width: STICKER_SHOWN, height: STICKER_SHOWN }} contentFit="contain" testID="file-sticker" />;
    return (
      <Pressy onPress={tap} onLongPress={onPick} label={t.sticker} scale={0.96} testID="file-sticker">
        <View style={{ width: STICKER_SHOWN, height: STICKER_SHOWN, borderRadius: 24, backgroundColor: theme.glass, alignItems: 'center', justifyContent: 'center' }}>
          {here && <Image source={{ uri: f.local }} style={{ position: 'absolute', width: '100%', height: '100%', opacity: 0.6 }} contentFit="contain" />}
          <View style={{ minWidth: 52, height: 52, paddingHorizontal: 12, borderRadius: 26, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' }}>{badge}</View>
        </View>
      </Pressy>
    );
  }

  if (f.kind === 'image' || f.kind === 'video') {
    const ratio = f.width && f.height ? f.height / f.width : 0.75;
    const height = Math.round(Math.min(320, Math.max(130, WIDE * ratio)));
    // A video I'm sending shows its sharp first frame (kept on this phone) instead of the blurry preview.
    const sharp = f.kind === 'video' && !!f.poster;
    const source = here && f.kind === 'image' ? { uri: f.local } : sharp ? { uri: f.poster } : f.thumb ? { uri: `data:image/jpeg;base64,${f.thumb}` } : null;
    return (
      <Pressy onPress={tap} onLongPress={onPick} label={f.kind === 'image' ? t.photoLabel : t.videoLabel} scale={0.98} testID={`file-${f.kind}`}>
        <View
          style={{
            width: WIDE,
            height,
            borderRadius: 14,
            overflow: 'hidden',
            backgroundColor: theme.glass,
            marginBottom: 4,
          }}
        >
          {f.gif && here ? (
            <GifView uri={f.local!} />
          ) : (
            source && <Image source={source} style={{ width: '100%', height: '100%' }} contentFit="cover" blurRadius={(here && f.kind === 'image') || sharp ? 0 : 6} transition={150} />
          )}
          {badge && (
            <View
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                start: 0,
                end: 0,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <View
                style={{
                  minWidth: 52,
                  height: 52,
                  paddingHorizontal: 12,
                  borderRadius: 26,
                  backgroundColor: 'rgba(0,0,0,0.45)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {badge}
              </View>
            </View>
          )}
          {f.gif && (
            <View style={{ position: 'absolute', start: 8, bottom: 6, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.45)' }}>
              <Txt size={11} weight="800" color="#FFFFFF">
                GIF
              </Txt>
            </View>
          )}
          {f.kind === 'video' && !f.gif && !!f.duration && (
            <View
              style={{
                position: 'absolute',
                start: 8,
                bottom: 6,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
              }}
            >
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
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          padding: 8,
          borderRadius: 12,
          backgroundColor: mine ? 'rgba(255,255,255,0.16)' : theme.glass,
          minWidth: 220,
          marginBottom: 4,
        }}
      >
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            backgroundColor: theme.accSoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
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
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: 'rgba(0,0,0,0.35)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {moving ? (
              <Stop progress={progress ?? 0} size={40} label={t.cancel} />
            ) : (
              <Icon name={paused ? 'upload' : 'download'} size={19} color="#FFFFFF" />
            )}
          </View>
        )}
      </View>
    </Pressy>
  );
}

/** A GIF: its little video, playing on a loop with no sound. */
function GifView({ uri }: { uri: string }) {
  const player = useVideoPlayer({ uri }, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  return <VideoView player={player} style={{ width: '100%', height: '100%' }} contentFit="cover" nativeControls={false} pointerEvents="none" />;
}

/** A ring that fills as the file moves, around a ✕ that stops it. */
function Stop({ progress, size, label }: { progress: number; size: number; label: string }) {
  const r = size / 2 - 3;
  const round = 2 * Math.PI * r;
  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
      }}
      accessibilityLabel={label}
      testID="file-progress"
    >
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.28)" strokeWidth={2.5} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="#FFFFFF"
          strokeWidth={2.5}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${round} ${round}`}
          strokeDashoffset={round * (1 - Math.max(0.03, Math.min(1, progress)))}
          rotation={-90}
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <Icon name="close" size={Math.round(size * 0.42)} color="#FFFFFF" />
    </View>
  );
}

/** Opens a file that's here: photos and videos in PakChat's viewer, documents in another app. */
export async function open(m: Message) {
  const f = m.file;
  if (!f?.local) return;
  if (f.kind === 'image' || f.kind === 'video') {
    router.push({
      pathname: '/viewer',
      params: { chat: m.chatId, author: m.author, id: m.id },
    });
    return;
  }
  try {
    await outsideFor(() => new File(f.local!).preview({ mimeType: f.mime }));
  } catch {
    // No app opens this kind of file: offer to send it somewhere instead.
    await outsideFor(() => Sharing.shareAsync(f.local!, {
      mimeType: f.mime,
      dialogTitle: f.name,
    })).catch(() => {});
  }
}
