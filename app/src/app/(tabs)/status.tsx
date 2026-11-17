// (tabs)/status.tsx: Status, updates that last 24 hours, like WhatsApp's.
//
// A list down the page, like WhatsApp's: "My status" (tap to see mine, or to add
// one; ⋮ for the page of my statuses and their views), then "Recent updates",
// "Viewed updates" and "Muted updates" (folded away; hold one to mute or unmute),
// each with a little picture of their newest status in its ring and the time.
// The two round buttons at the bottom add one: words (pencil) or a photo or video.
import type { Message } from '@pakchat/shared';
import { Image } from 'expo-image';
import { router, useIsFocused } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import Animated from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { core } from '../../core/core';
import { useAfterStart, useAuth, usePeople, useStatuses } from '../../core/hooks';
import { STATUS_BG, voiceColour, type StatusPerson } from '../../core/status';
import { useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { Icon } from '../../ui/icons';
import { listTime } from '../../ui/format';
import { Avatar, Fab, IconButton, Pressy, Screen, Txt } from '../../ui/kit';
import { MenuItem, Sheet } from '../../ui/overlays';

const PHOTO = 52;

/** Drawn once the chat list has shown after starting (useAfterStart): its turn is 1 of 3, or at once if you go to it first. */
export default function StatusTab() {
  return useAfterStart(1, useIsFocused()) ? <Status /> : null;
}

function Status() {
  const t = useT();
  const { theme } = useLook();
  const { me, myId } = useAuth();
  const all = useStatuses();
  usePeople();
  const [held, setHeld] = useState<StatusPerson | null>(null);
  const [showMuted, setShowMuted] = useState(false);

  const mine = all?.mine;
  const others = all?.others ?? [];
  const fresh = others.filter((p) => !p.seen && !p.muted);
  const seen = others.filter((p) => p.seen && !p.muted);
  const muted = others.filter((p) => p.muted);
  const open = (p: StatusPerson) => router.push({ pathname: '/status/[id]', params: { id: p.chat.id } });
  const mineCount = mine?.items.length ?? 0;
  const add = () => router.push({ pathname: '/status-new', params: { kind: 'media' } });

  return (
    <Screen bottom={false}>
      <View style={{ paddingTop: 18, paddingHorizontal: 20, paddingBottom: 6, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Txt size={27} weight="800" style={{ letterSpacing: -0.9, flex: 1 }}>
          {t.status}
        </Txt>
        <IconButton icon="lock" label={t.statusPrivacy} onPress={() => router.push('/settings/status-privacy')} color={theme.muted} testID="status-privacy" />
      </View>
      {/* A list down the page, like WhatsApp's: mine, then new, seen and muted ones, each with its time. */}
      <ScrollView contentContainerStyle={{ paddingBottom: 170 }} testID="status-row-list">
        <Pressy
          onPress={() => (mineCount ? router.push({ pathname: '/status/[id]', params: { id: mine!.chat.id } }) : add())}
          onLongPress={add}
          label={mineCount ? t.myStatus : t.addStatus}
          scale={0.98}
          testID="my-status"
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 10 }}>
            <View>
              <Ring count={mineCount} seen={false} color={theme.acc} muted={theme.muted}>
                {mine?.items.length ? <Thumb m={mine.items.at(-1)!} /> : <Avatar id={myId} name={me?.name ?? ''} size={PHOTO} />}
              </Ring>
              {!mineCount && (
                <View style={{ position: 'absolute', end: 0, bottom: 0, width: 22, height: 22, borderRadius: 11, backgroundColor: theme.acc, borderWidth: 2, borderColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="plus" size={12} color="#FFFFFF" stroke={3} />
                </View>
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Txt size={16} weight="600" lines={1}>
                {t.myStatus}
              </Txt>
              <Txt size={13.5} color={theme.muted} lines={1}>
                {mineCount ? listTime(mine!.latest, t) : t.tapToAddStatus}
              </Txt>
            </View>
            {/* My status page: each one with its views. */}
            {mineCount > 0 && <IconButton icon="more" label={t.myStatus} onPress={() => router.push('/status-mine')} color={theme.muted} testID="my-status-page" />}
          </View>
        </Pressy>
        {fresh.length > 0 && <Head text={t.recentUpdates} />}
        {fresh.map((p) => (
          <StatusRow key={p.chat.id} p={p} onPress={() => open(p)} onLongPress={() => setHeld(p)} />
        ))}
        {seen.length > 0 && <Head text={t.viewedUpdates} />}
        {seen.map((p) => (
          <StatusRow key={p.chat.id} p={p} onPress={() => open(p)} onLongPress={() => setHeld(p)} />
        ))}
        {muted.length > 0 && (
          <Pressy onPress={() => setShowMuted(!showMuted)} label={t.mutedUpdates} scale={0.98} testID="status-muted-head">
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Head text={t.mutedUpdates} />
              <View style={{ flex: 1 }} />
              <View style={{ paddingHorizontal: 18, paddingTop: 10, transform: [{ rotate: showMuted ? '-90deg' : '90deg' }] }}>
                <Icon name="chevron" size={16} color={theme.muted} />
              </View>
            </View>
          </Pressy>
        )}
        {showMuted &&
          muted.map((p) => (
            <StatusRow key={p.chat.id} p={p} onPress={() => open(p)} onLongPress={() => setHeld(p)} />
          ))}
        {all && !others.length && (
          <Txt size={14} color={theme.muted} align="center" style={{ marginTop: 30, paddingHorizontal: 30 }}>
            {t.noStatuses}
          </Txt>
        )}
      </ScrollView>
      {/* Two round buttons at the bottom, like WhatsApp's: words (the small one) and the camera. */}
      <View style={{ position: 'absolute', end: 29, bottom: 92 }} pointerEvents="box-none">
        <Pressy onPress={() => router.push({ pathname: '/status-new', params: { kind: 'text' } })} label={t.textStatus} round testID="status-text">
          <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: theme.dark ? '#2A3140' : '#E7EDF8', alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 14px -6px rgba(0,0,0,0.3)' }}>
            <Icon name="edit" size={20} color={theme.accInk} />
          </View>
        </Pressy>
      </View>
      <Fab icon="camera" label={t.photoStatus} onPress={add} testID="status-media" bottom={20} />
      <Sheet visible={held !== null} onClose={() => setHeld(null)} title={held ? core.name(held.owner) : undefined}>
        {held && (
          <MenuItem
            icon={held.muted ? 'bell' : 'muted'}
            label={held.muted ? t.unmute : t.mute}
            onPress={() => {
              core.setPrefs(held.chat.id, { muted: !held.muted });
              setHeld(null);
            }}
            testID="status-mute"
          />
        )}
      </Sheet>
    </Screen>
  );
}

function Head({ text }: { text: string }) {
  const { theme } = useLook();
  return (
    <Txt size={13.5} weight="600" color={theme.muted} style={{ paddingHorizontal: 18, paddingTop: 14, paddingBottom: 4 }}>
      {text}
    </Txt>
  );
}

/** A little picture of someone's newest status, in their circle, like WhatsApp's (words: their colour). */
function Thumb({ m }: { m: Message }) {
  const f = m.file;
  const uri = f ? (f.local && f.kind === 'image' ? f.local : (f.poster ?? (f.thumb ? `data:image/jpeg;base64,${f.thumb}` : null))) : null;
  if (uri) return <Image source={{ uri }} style={{ width: PHOTO, height: PHOTO, borderRadius: PHOTO / 2 }} contentFit="cover" />;
  // A voice status: a mic on its colour.
  if (f?.kind === 'voice')
    return (
      <View style={{ width: PHOTO, height: PHOTO, borderRadius: PHOTO / 2, backgroundColor: voiceColour(m.id), alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="mic" size={22} color="#FFFFFF" />
      </View>
    );
  return (
    <View style={{ width: PHOTO, height: PHOTO, borderRadius: PHOTO / 2, backgroundColor: STATUS_BG[m.bg ?? 0] ?? STATUS_BG[0], alignItems: 'center', justifyContent: 'center', padding: 6, overflow: 'hidden' }}>
      <Txt size={9} weight="700" color="#FFFFFF" align="center" lines={3}>
        {m.text ?? ''}
      </Txt>
    </View>
  );
}

/** One person: their newest status in its ring, their name, and when. */
function StatusRow({ p, onPress, onLongPress }: { p: StatusPerson; onPress: () => void; onLongPress: () => void }) {
  const t = useT();
  const { theme } = useLook();
  const name = (core.name(p.owner) || '…').replace(/^~ /, '');
  const last = p.items.at(-1);
  return (
    <Animated.View style={{ opacity: p.muted ? 0.55 : 1 }}>
      <Pressy onPress={onPress} onLongPress={onLongPress} label={name} scale={0.98} testID="status-row">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 8 }}>
          <Ring count={p.items.length} seen={p.seen || !!p.muted} color={theme.acc} muted={theme.faint}>
            {last ? <Thumb m={last} /> : <Avatar id={p.owner} name={name} size={PHOTO} />}
          </Ring>
          <View style={{ flex: 1 }}>
            <Txt size={16} weight="600" lines={1}>
              {name}
            </Txt>
            <Txt size={13.5} color={theme.muted} lines={1}>
              {listTime(p.latest, t)}
            </Txt>
          </View>
        </View>
      </Pressy>
    </Animated.View>
  );
}

/** The ring around a picture: one piece per status, coloured until seen. */
function Ring({ count, seen, color, muted, children }: { count: number; seen: boolean; color: string; muted: string; children: ReactNode }) {
  const size = PHOTO + 10;
  const r = size / 2 - 2;
  const round = 2 * Math.PI * r;
  const gap = count > 1 ? 6 : 0;
  const piece = count ? round / count - gap : round;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {count > 0 && (
        <Svg width={size} height={size} style={{ position: 'absolute' }}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={seen ? muted : color}
            strokeWidth={2.5}
            fill="none"
            strokeDasharray={count > 1 ? `${piece} ${gap}` : undefined}
            rotation={-90}
            origin={`${size / 2}, ${size / 2}`}
          />
        </Svg>
      )}
      {children}
    </View>
  );
}
