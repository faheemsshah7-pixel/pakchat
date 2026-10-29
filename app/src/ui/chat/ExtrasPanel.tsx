// ExtrasPanel.tsx: the panel the sticker button in the message bar opens, with three
// tabs, like WhatsApp. It opens on Stickers.
//
//   Stickers   the ones I sent lately, then my saved ones (+ makes one from a photo, hold one
//              to remove it), then PakChat's pack, like WhatsApp's Recent and Favourites
//   GIF        popular ones, or search; tap one to send it (hidden when the server has no GIFs)
//   Emoji      tap one to add it to your message
import type { Gif } from '@pakchat/shared';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, ScrollView, TextInput, View } from 'react-native';

import { isOffline } from '../../core/core';
import { useRecentStickers, useSavedStickers } from '../../core/hooks';
import { findGifs, gifsAvailable, PACK, removeSticker, stickerFromPhoto } from '../../core/stickers';
import { useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { Icon, type IconName } from '../icons';
import { fontStyle, Glass, Pressy, Txt } from '../kit';
import { tick } from '../motion';
import { toast } from '../overlays';
import { squarePhoto } from './attachments';

export const EMOJI = [
  '😂', '❤️', '👍', '🙏', '😍', '😭', '🔥', '😊', '🤲', '💯', '😅', '🥰', '👌', '😢', '🎉', '🤣',
  '✨', '🌙', '😘', '😁', '🙂', '😉', '😎', '🤔', '🙄', '😴', '😡', '🥺', '😱', '🤗', '🤝', '👏',
  '💪', '🙌', '✌️', '👋', '💐', '🌹', '🌸', '☀️', '⭐', '💚', '💙', '💔', '🕌', '📿', '☕', '🍵',
  '🥭', '🍉', '🍕', '🎂', '🏏', '⚽', '🇵🇰', '✅', '❌', '⏰', '📞', '📍', '🚗', '🏠', '💼', '📚',
];

export type Tab = 'emoji' | 'gif' | 'sticker';

const HEIGHT = 300;

export function ExtrasPanel({ onEmoji, onGif, onSticker }: { onEmoji: (e: string) => void; onGif: (g: Gif) => void; onSticker: (from: string | number) => void }) {
  const t = useT();
  const { theme } = useLook();
  const [tab, setTab] = useState<Tab>('sticker');
  // The GIF tab shows unless the server said it has no GIFs.
  const [gifsOn, setGifsOn] = useState(gifsAvailable() !== false);

  const tabs: { key: Tab; icon: IconName; label: string }[] = [
    { key: 'sticker', icon: 'sticker', label: t.stickers },
    ...(gifsOn ? [{ key: 'gif' as const, icon: 'gif' as const, label: t.gifWord }] : []),
    { key: 'emoji', icon: 'emoji', label: t.emoji },
  ];

  return (
    <View>
      <Glass strong style={{ marginHorizontal: 10, marginTop: 8, borderRadius: 20, overflow: 'hidden' }}>
        <View style={{ height: HEIGHT }}>
          {tab === 'emoji' && <EmojiTab onEmoji={onEmoji} />}
          {tab === 'gif' && (
            <GifTab
              onGif={onGif}
              onNone={() => {
                setGifsOn(false);
                setTab('sticker');
              }}
            />
          )}
          {tab === 'sticker' && <StickerTab onSticker={onSticker} />}
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, padding: 6, borderTopWidth: 1, borderColor: theme.divider }}>
          {tabs.map((x) => {
            const on = x.key === tab;
            return (
              <Pressy key={x.key} onPress={() => (tick(), setTab(x.key))} label={x.label} scale={0.9} testID={`panel-${x.key}`}>
                <View style={{ height: 34, paddingHorizontal: 16, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: on ? theme.accSoft : 'transparent' }}>
                  <Icon name={x.icon} size={19} color={on ? theme.accInk : theme.muted} />
                  {on && (
                    <Txt size={13} weight="700" color={theme.accInk}>
                      {x.label}
                    </Txt>
                  )}
                </View>
              </Pressy>
            );
          })}
        </View>
      </Glass>
    </View>
  );
}

function EmojiTab({ onEmoji }: { onEmoji: (e: string) => void }) {
  return (
    <ScrollView contentContainerStyle={{ padding: 6, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' }} keyboardShouldPersistTaps="always">
      {EMOJI.map((e) => (
        <Pressy key={e} onPress={() => onEmoji(e)} label={e} scale={0.85}>
          <View style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
            <Txt size={24} align="center">
              {e}
            </Txt>
          </View>
        </Pressy>
      ))}
    </ScrollView>
  );
}

function GifTab({ onGif, onNone }: { onGif: (g: Gif) => void; onNone: () => void }) {
  const t = useT();
  const { theme, lang } = useLook();
  const [q, setQ] = useState('');
  const [gifs, setGifs] = useState<Gif[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  // Each search has a number, so an old, slow answer can't replace a newer one.
  const asked = useRef(0);

  // A search waits until you stop typing for a moment.
  useEffect(() => {
    const n = ++asked.current;
    const wait = setTimeout(
      () => {
        setBusy(true);
        setProblem(null);
        findGifs(q, lang)
          .then((r) => {
            if (n !== asked.current) return;
            if (!r) return onNone();
            setGifs(r.gifs);
            setNext(r.next);
          })
          .catch((err: unknown) => n === asked.current && setProblem(isOffline(err) ? t.offline : t.couldNot))
          .finally(() => n === asked.current && setBusy(false));
      },
      q ? 450 : 0,
    );
    return () => clearTimeout(wait);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, lang]);

  function more() {
    if (busy || !next) return;
    const n = asked.current;
    setBusy(true);
    findGifs(q, lang, next)
      .then((r) => {
        if (n !== asked.current || !r) return;
        setGifs((old) => [...old, ...r.gifs.filter((g) => !old.some((o) => o.id === g.id))]);
        setNext(r.next);
      })
      .catch(() => {})
      .finally(() => n === asked.current && setBusy(false));
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, margin: 8, paddingHorizontal: 12, height: 38, borderRadius: 12, backgroundColor: theme.glass }}>
        <Icon name="search" size={17} color={theme.muted} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder={t.searchGifs}
          placeholderTextColor={theme.muted}
          selectionColor={theme.acc}
          style={[fontStyle(q || null, lang, 14.5, '400'), { flex: 1, color: theme.text, paddingVertical: 0 }]}
          testID="gif-search"
        />
      </View>
      {problem && !gifs.length ? (
        <Txt size={14} color={theme.muted} align="center" style={{ marginTop: 40 }}>
          {problem}
        </Txt>
      ) : (
        <FlatList
          data={gifs}
          keyExtractor={(g) => g.id}
          numColumns={3}
          keyboardShouldPersistTaps="always"
          contentContainerStyle={{ paddingHorizontal: 5, paddingBottom: 8 }}
          onEndReached={more}
          onEndReachedThreshold={0.5}
          renderItem={({ item }) => (
            <Pressy onPress={() => onGif(item)} label={t.gifWord} scale={0.94} style={{ flex: 1 / 3 }} testID="gif-item">
              <View style={{ margin: 3, height: 96, borderRadius: 10, overflow: 'hidden', backgroundColor: theme.glass }}>
                <Image source={{ uri: item.preview }} style={{ width: '100%', height: '100%' }} contentFit="cover" autoplay />
              </View>
            </Pressy>
          )}
          ListEmptyComponent={
            busy ? undefined : (
              <Txt size={14} color={theme.muted} align="center" style={{ marginTop: 40 }}>
                {t.noGifs}
              </Txt>
            )
          }
          ListFooterComponent={busy ? <ActivityIndicator color={theme.acc} style={{ margin: 16 }} /> : undefined}
        />
      )}
      <Txt size={10.5} color={theme.faint} align="center" style={{ paddingBottom: 4 }}>
        {t.gifsBy}
      </Txt>
    </View>
  );
}

function StickerTab({ onSticker }: { onSticker: (from: string | number) => void }) {
  const t = useT();
  const { theme } = useLook();
  const saved = useSavedStickers();
  const recent = useRecentStickers();
  const [making, setMaking] = useState(false);

  async function make() {
    if (making) return;
    try {
      const p = await squarePhoto();
      if (!p || !p.width || !p.height) return;
      setMaking(true);
      const uri = await stickerFromPhoto(p.uri, p.width, p.height);
      onSticker(uri);
    } catch {
      toast(t.couldNot);
    } finally {
      setMaking(false);
    }
  }

  const tile = { width: 72, height: 72, margin: 4 };
  const heading = (icon: 'clock' | 'star' | 'sticker', text: string, top: number) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 6, marginTop: top, marginBottom: 4 }}>
      <Icon name={icon} size={14} color={theme.muted} />
      <Txt size={12.5} weight="700" color={theme.muted}>
        {text}
      </Txt>
    </View>
  );
  return (
    <ScrollView contentContainerStyle={{ padding: 8 }}>
      {recent.length > 0 && (
        <>
          {heading('clock', t.recentStickers, 0)}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {recent.map((from) => (
              <Pressy key={String(from)} onPress={() => onSticker(from)} label={t.sticker} scale={0.9} testID="sticker-recent">
                <Image source={typeof from === 'number' ? from : { uri: from }} style={tile} contentFit="contain" />
              </Pressy>
            ))}
          </View>
        </>
      )}
      {heading('star', t.myStickers, recent.length > 0 ? 10 : 0)}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        <Pressy onPress={() => void make()} label={t.stickerFromPhoto} scale={0.9} testID="sticker-make">
          <View style={[tile, { borderRadius: 16, borderWidth: 2, borderStyle: 'dashed', borderColor: theme.faint, alignItems: 'center', justifyContent: 'center' }]}>
            {making ? <ActivityIndicator color={theme.acc} /> : <Icon name="plus" size={24} color={theme.muted} />}
          </View>
        </Pressy>
        {saved.map((s) => (
          <Pressy
            key={s.id}
            onPress={() => onSticker(s.uri)}
            onLongPress={() => {
              removeSticker(s.id);
              toast(t.stickerRemoved);
            }}
            label={t.sticker}
            scale={0.9}
            testID="sticker-saved"
          >
            <Image source={{ uri: s.uri }} style={tile} contentFit="contain" />
          </Pressy>
        ))}
      </View>
      {heading('sticker', 'PakChat', 10)}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {PACK.map((s) => (
          <Pressy key={s.name} onPress={() => onSticker(s.source)} label={t.sticker} scale={0.9} testID={`sticker-${s.name}`}>
            <Image source={s.source} style={tile} contentFit="contain" />
          </Pressy>
        ))}
      </View>
    </ScrollView>
  );
}
