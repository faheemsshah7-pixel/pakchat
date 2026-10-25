// wallpaper.tsx: pick what's behind a chat (`chat`), or behind every chat
// that hasn't its own (no `chat`, from Settings), the way WhatsApp does it.
// The top shows the wallpaper now, with a slider to darken it in Graphite.
// Tapping one below opens it full screen with a few sample messages, where
// you swipe through the others of its kind (a colour can have doodles over
// it), then Set wallpaper: from a chat it asks "for this chat" or "for all
// chats". A photo is copied into PakChat, so it stays even if it's deleted
// from the gallery.
import { File, Paths } from 'expo-file-system';
import { router, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState, type ReactNode } from 'react';
import { BackHandler, FlatList, ScrollView, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { core, type Wallpaper } from '../core/core';
import { useChat, useChatPrefs, useSettings } from '../core/hooks';
import { fill, useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { fromGallery } from '../ui/chat/attachments';
import { Backdrop, WALL_COLOURS, WALL_GRADIENTS } from '../ui/chat/Backdrop';
import { clock } from '../ui/format';
import { Icon } from '../ui/icons';
import { Button, Glass, IconButton, Pressy, Screen, Section, Toggle, TopBar, Txt } from '../ui/kit';
import { MenuItem, Sheet, toast } from '../ui/overlays';
import { Slider } from '../ui/Slider';

/** What's open full screen: the wallpapers of one kind, and which one is showing. */
type Looking = { list: Wallpaper[]; at: number };

const COLOURS: Wallpaper[] = WALL_COLOURS.map((_, i) => ({ kind: 'colour', value: i }));
const GRADIENTS: Wallpaper[] = WALL_GRADIENTS.map((_, i) => ({ kind: 'gradient', value: i }));
const OTHERS: Wallpaper[] = [{ kind: 'doodles' }, { kind: 'none' }];

/** A photo file of PakChat's own, kept while a wallpaper uses it. */
function forget(uri: string | number | undefined) {
  if (typeof uri !== 'string') return;
  try {
    new File(uri).delete();
  } catch {
    // Already gone.
  }
}

export default function WallpaperScreen() {
  const { chat: chatId } = useLocalSearchParams<{ chat?: string }>();
  const t = useT();
  const { theme } = useLook();
  const settings = useSettings();
  const prefs = useChatPrefs(chatId ?? '');
  const chat = useChat(chatId ?? '');
  const own = chatId ? prefs.wallpaper : settings.wallpaper;
  const [dim, setDim] = useState<number | null>(null);
  const [looking, setLooking] = useState<Looking | null>(null);
  const [asking, setAsking] = useState<Wallpaper | null>(null);
  const now = own ?? (chatId ? settings.wallpaper : undefined);
  // While the slider moves, the picture follows it (saved once it's let go).
  const shown = now && dim !== null ? { ...now, dim } : now;
  const kind = now?.kind ?? 'doodles';

  /** Saves a wallpaper for this chat, or for all chats; a photo no longer used is deleted. */
  function save(wp: Wallpaper | undefined, all: boolean) {
    if (all) {
      const was = [settings.wallpaper?.value, chatId ? prefs.wallpaper?.value : undefined];
      core.setSettings({ wallpaper: wp });
      // "For all chats" from a chat: this chat follows the rest again.
      if (chatId && prefs.wallpaper) core.setPrefs(chatId, { wallpaper: undefined });
      was.filter((v) => v !== wp?.value).forEach(forget);
    } else if (chatId) {
      const was = prefs.wallpaper?.value;
      core.setPrefs(chatId, { wallpaper: wp });
      if (was !== wp?.value && was !== settings.wallpaper?.value) forget(was);
    }
  }

  function set(wp: Wallpaper) {
    if (chatId) return setAsking(wp);
    save(wp, true);
    done();
  }

  function done() {
    setAsking(null);
    setLooking(null);
    toast(t.wallpaperSet);
  }

  /** Closes the full-screen look; a photo picked but not set is deleted again. */
  function close() {
    const photo = looking?.list[0];
    if (photo?.kind === 'photo' && photo.value !== settings.wallpaper?.value && photo.value !== prefs.wallpaper?.value) forget(photo.value);
    setLooking(null);
  }

  async function photo() {
    try {
      const [p] = await fromGallery(false);
      if (!p || p.kind !== 'image') return;
      const copy = new File(Paths.document, `wallpaper-${core.newId()}.jpg`);
      await new File(p.uri).copy(copy);
      setLooking({ list: [{ kind: 'photo', value: copy.uri, dim: 0.35 }], at: 0 });
    } catch {
      toast(t.couldNot);
    }
  }

  const on = (wp: Wallpaper) => kind === wp.kind && (wp.value === undefined || Number(now?.value ?? 0) === wp.value);
  const look = (list: Wallpaper[], at: number) => setLooking({ list: list.map((w) => (w.kind === 'colour' && on(w) ? { ...w, doodles: now?.doodles } : w)), at });

  return (
    <Screen>
      <TopBar title={t.wallpaper} subtitle={chatId && chat ? core.chatTitle(chat) : t.allChats} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 40 }}>
        {/* The wallpaper now, like a small phone. */}
        <View
          style={{ alignSelf: 'center', width: 190, height: 330, borderRadius: 28, overflow: 'hidden', backgroundColor: theme.bg, borderWidth: 5, borderColor: theme.dark ? '#2A2D34' : '#FFFFFF' }}
        >
          <Backdrop wp={shown} />
          <Sample small />
        </View>

        {theme.dark && kind !== 'none' && (
          <Glass style={{ padding: 14, marginTop: 16, gap: 6 }}>
            <Txt size={14} weight="600">
              {t.wallpaperDimming}
            </Txt>
            <Slider
              value={(dim ?? now?.dim ?? (kind === 'photo' ? 0.35 : 0)) / 0.8}
              onChange={(v) => setDim(Math.round(v * 80) / 100)}
              onDone={(v) => {
                const wp = { ...(now ?? { kind: 'doodles' as const }), dim: Math.round(v * 80) / 100 };
                if (chatId) core.setPrefs(chatId, { wallpaper: wp });
                else core.setSettings({ wallpaper: wp });
                setDim(null);
              }}
              label={t.wallpaperDimming}
              testID="wall-dim"
            />
          </Glass>
        )}

        <Section title={t.wallpaperKinds} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          <Tile label={t.myPhotos} on={kind === 'photo'} onPress={() => void photo()} testID="wall-photo">
            {now?.kind === 'photo' ? <Backdrop wp={now} /> : <Icon name="photo" size={26} color={theme.accInk} />}
          </Tile>
          <Tile label={t.doodles} on={on(OTHERS[0])} onPress={() => look(OTHERS, 0)} testID="wall-doodles">
            <Backdrop wp={OTHERS[0]} />
          </Tile>
          <Tile label={t.noWallpaper} on={on(OTHERS[1])} onPress={() => look(OTHERS, 1)} testID="wall-none" />
        </View>

        <Section title={t.colours} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {COLOURS.map((wp, i) => (
            <Tile key={i} label={fill(t.colourN, { n: i + 1 })} on={on(wp)} onPress={() => look(COLOURS, i)} testID={`wall-colour-${i}`}>
              <Backdrop wp={wp} />
            </Tile>
          ))}
        </View>

        <Section title={t.gradients} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {GRADIENTS.map((wp, i) => (
            <Tile key={i} label={fill(t.gradientN, { n: i + 1 })} on={on(wp)} onPress={() => look(GRADIENTS, i)} testID={`wall-gradient-${i}`}>
              <Backdrop wp={wp} />
            </Tile>
          ))}
        </View>

        {chatId && !!own && (
          <Button
            title={t.useDefaultWallpaper}
            look="soft"
            onPress={() => {
              save(undefined, false);
              toast(t.wallpaperSet);
            }}
            style={{ marginTop: 18 }}
            testID="wall-reset"
          />
        )}
      </ScrollView>

      {looking && <Look looking={looking} onClose={close} onSet={set} />}

      {/* From a chat: this chat only, or every chat (like WhatsApp). */}
      <Sheet visible={!!asking} onClose={() => setAsking(null)} title={t.setWallpaper}>
        <MenuItem
          icon="chat"
          label={t.forThisChat}
          onPress={() => {
            if (asking) save(asking, false);
            done();
          }}
          testID="wall-this-chat"
        />
        <MenuItem
          icon="group"
          label={t.forAllChats}
          onPress={() => {
            if (asking) save(asking, true);
            done();
          }}
          testID="wall-all-chats"
        />
      </Sheet>
    </Screen>
  );
}

/** A wallpaper full screen, with sample messages on it: swipe for the others of its kind. */
function Look({ looking, onClose, onSet }: { looking: Looking; onClose: () => void; onSet: (wp: Wallpaper) => void }) {
  const t = useT();
  const { theme } = useLook();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [at, setAt] = useState(looking.at);
  const [list, setList] = useState(looking.list);
  const [height, setHeight] = useState(0);
  const wp = list[at];

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => (onClose(), true));
    return () => sub.remove();
  }, [onClose]);

  return (
    <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(140)} style={{ position: 'absolute', top: 0, start: 0, end: 0, bottom: 0, backgroundColor: theme.bg, zIndex: 10 }}>
      <FlatList
        data={list}
        horizontal
        pagingEnabled
        initialScrollIndex={looking.at}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        showsHorizontalScrollIndicator={false}
        keyExtractor={(_, i) => String(i)}
        onMomentumScrollEnd={(e) => setAt(Math.round(e.nativeEvent.contentOffset.x / width))}
        onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
        style={{ flex: 1 }}
        renderItem={({ item }) => (
          <View style={{ width, height }}>
            <Backdrop wp={item} />
          </View>
        )}
        testID="wall-look"
      />
      <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, start: 0, end: 0, bottom: 0 }}>
        <View style={{ paddingTop: insets.top, backgroundColor: theme.dark ? '#17181C' : '#FFFFFF' }}>
          <View style={{ height: 56, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 }}>
            <IconButton icon="back" label={t.back} flip onPress={onClose} testID="wall-look-back" />
            <Txt size={18} weight="700">
              {t.previewWord}
            </Txt>
          </View>
        </View>
        <View pointerEvents="none" style={{ flex: 1 }}>
          <Sample hint={list.length > 1} />
        </View>
        <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: insets.bottom + 14, gap: 10, backgroundColor: theme.dark ? 'rgba(23,24,28,0.94)' : 'rgba(255,255,255,0.94)' }}>
          {wp.kind === 'colour' && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Txt size={15} weight="600" style={{ flex: 1 }}>
                {t.pakchatDoodles}
              </Txt>
              <Toggle on={!!wp.doodles} onChange={(v) => setList(list.map((w) => (w.kind === 'colour' ? { ...w, doodles: v } : w)))} label={t.pakchatDoodles} testID="wall-look-doodles" />
            </View>
          )}
          <Button title={t.setWallpaper} onPress={() => onSet(wp)} testID="wall-look-set" />
        </View>
      </View>
    </Animated.View>
  );
}

/** "Today", a message from them and one from you, as they'd look on the wallpaper. */
function Sample({ small, hint }: { small?: boolean; hint?: boolean }) {
  const t = useT();
  const { theme } = useLook();
  const k = small ? 0.72 : 1;
  const [at] = useState(() => clock(Date.now()));
  return (
    <View style={{ flex: 1, justifyContent: 'flex-end', padding: 14 * k, gap: 8 * k }}>
      <View style={{ alignSelf: 'center', paddingHorizontal: 10 * k, paddingVertical: 4 * k, borderRadius: 9, backgroundColor: theme.glass, marginBottom: 4 * k }}>
        <Txt size={12 * k} weight="600" color={theme.muted}>
          {t.today}
        </Txt>
      </View>
      {hint && <Bubble text={t.swipeToPreview} at={at} k={k} />}
      <Bubble text={t.wallpaperSampleIn} at={at} k={k} />
      <Bubble text={t.wallpaperSampleOut} at={at} k={k} mine />
    </View>
  );
}

function Bubble({ text, at, k, mine }: { text: string; at: string; k: number; mine?: boolean }) {
  const { theme } = useLook();
  const inner = (
    <>
      <Txt size={14.5 * k} color={mine ? theme.bubbleMineText : theme.text}>
        {text}
      </Txt>
      <Txt size={10.5 * k} color={mine ? theme.bubbleMineText : theme.muted} style={{ alignSelf: 'flex-end', opacity: 0.7 }}>
        {at}
      </Txt>
    </>
  );
  const style = {
    alignSelf: mine ? ('flex-end' as const) : ('flex-start' as const),
    maxWidth: '80%' as const,
    borderRadius: 18 * k,
    paddingHorizontal: 12 * k,
    paddingVertical: 7 * k,
    ...(mine ? { borderBottomEndRadius: 6 } : { borderBottomStartRadius: 6 }),
  };
  return mine ? (
    <LinearGradient colors={theme.bubbleMine} style={style}>
      {inner}
    </LinearGradient>
  ) : (
    <View style={[style, { backgroundColor: theme.bubbleIn }]}>{inner}</View>
  );
}

/** One wallpaper to pick: a little picture of it, ticked when it's the one. */
function Tile({ label, on, onPress, children, testID }: { label: string; on: boolean; onPress: () => void; children?: ReactNode; testID: string }) {
  const { theme } = useLook();
  return (
    <Pressy onPress={onPress} label={label} scale={0.94} testID={testID}>
      <View
        style={{
          width: 76,
          height: 104,
          borderRadius: 16,
          overflow: 'hidden',
          borderWidth: 2.5,
          borderColor: on ? theme.acc : theme.glassLine,
          backgroundColor: theme.bg,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {children}
        {on && (
          <View style={{ position: 'absolute', top: 6, end: 6, width: 20, height: 20, borderRadius: 10, backgroundColor: theme.acc, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="check" size={12} color="#FFFFFF" stroke={3} />
          </View>
        )}
        {!children && (
          <Txt size={11.5} weight="600" color={theme.muted} align="center">
            {label}
          </Txt>
        )}
      </View>
    </Pressy>
  );
}
