// (tabs)/status.tsx: Status, updates that last 24 hours, like WhatsApp's.
//
// Like WhatsApp's: a row of picture cards, swipe for more. Mine first ("Add status",
// or my newest: tap to watch, + to add another, hold for the page of my statuses and
// their views), then people with new ones, then ones I've seen (grey ring). Each card
// is their newest status with their photo in its ring. "Muted updates" is folded away
// below (hold any of them to mute or unmute).
// The two round buttons at the bottom add one: words (pencil) or a photo or video.
import type { Message } from '@pakchat/shared';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useIsFocused } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
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
  const ready = useAfterStart(1, useIsFocused());
  // The same tab each time: coming to it or leaving it doesn't redraw all of it (only its own
  // changes do). On a new day it does, so times like "10:30 pm" turn into "Yesterday".
  const day = new Date().toDateString();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const body = useMemo(() => <Status />, [day]);
  return ready ? body : null;
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
        {/* My status page (each of mine and who saw it): in sight, not only by holding my card. */}
        {mineCount > 0 && <IconButton icon="eye" label={t.myStatus} onPress={() => router.push('/status-mine')} color={theme.muted} testID="status-mine" />}
        <IconButton icon="lock" label={t.statusPrivacy} onPress={() => router.push('/settings/status-privacy')} color={theme.muted} testID="status-privacy" />
      </View>
      {/* Like WhatsApp's: a row of picture cards (mine first, then new ones, then ones I've seen,
          swipe for more), and muted ones folded away below. */}
      <ScrollView contentContainerStyle={{ paddingBottom: 170 }} testID="status-row-list">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 14, paddingTop: 6, paddingBottom: 8 }} testID="status-cards">
          <MyCard
            mine={mine}
            name={me?.name ?? ''}
            myId={myId}
            onPress={() => (mineCount ? router.push({ pathname: '/status/[id]', params: { id: mine!.chat.id } }) : add())}
            onAdd={add}
            onPage={() => router.push('/status-mine')}
          />
          {[...fresh, ...seen].map((p) => (
            <Card key={p.chat.id} p={p} onPress={() => open(p)} onLongPress={() => setHeld(p)} />
          ))}
        </ScrollView>
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
          <Txt size={14} color={theme.muted} align="center" style={{ marginTop: 24, paddingHorizontal: 30 }}>
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

const CARD_W = 96;
const CARD_H = 156;

/** Their newest status filling a card: the photo or video's picture, or words (or a mic) on its colour. */
function CardPicture({ m }: { m: Message }) {
  const f = m.file;
  const uri = f ? (f.local && f.kind === 'image' ? f.local : (f.poster ?? (f.thumb ? `data:image/jpeg;base64,${f.thumb}` : null))) : null;
  if (uri) return <Image source={{ uri }} style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0 }} contentFit="cover" recyclingKey={m.id} />;
  if (f?.kind === 'voice')
    return (
      <View style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, backgroundColor: voiceColour(m.id), alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="mic" size={30} color="#FFFFFF" />
      </View>
    );
  return (
    <View style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, backgroundColor: STATUS_BG[m.bg ?? 0] ?? STATUS_BG[0], alignItems: 'center', justifyContent: 'center', padding: 10 }}>
      <Txt size={13} weight="700" color="#FFFFFF" align="center" lines={4}>
        {m.text ?? ''}
      </Txt>
    </View>
  );
}

/** The name at a card's foot, readable on any picture. */
function CardName({ text }: { text: string }) {
  return (
    <>
      <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)']} style={{ position: 'absolute', start: 0, end: 0, bottom: 0, height: 56 }} pointerEvents="none" />
      <Txt size={12.5} weight="700" color="#FFFFFF" lines={2} style={{ position: 'absolute', start: 8, end: 8, bottom: 8 }}>
        {text}
      </Txt>
    </>
  );
}

/** One person's card: their newest status, their photo in its ring at the top, their name. Seen: a grey ring. */
function Card({ p, onPress, onLongPress }: { p: StatusPerson; onPress: () => void; onLongPress: () => void }) {
  const { theme } = useLook();
  const name = (core.name(p.owner) || '…').replace(/^~ /, '');
  const last = p.items.at(-1);
  return (
    <Pressy onPress={onPress} onLongPress={onLongPress} label={name} testID="status-row" style={{ borderRadius: 16 }}>
      <View style={{ width: CARD_W, height: CARD_H, borderRadius: 16, overflow: 'hidden', backgroundColor: theme.glass }}>
        {last && <CardPicture m={last} />}
        <View style={{ position: 'absolute', top: 6, start: 6 }}>
          <Ring count={p.items.length} seen={p.seen} color={theme.acc} muted="rgba(255,255,255,0.55)" size={34}>
            <Avatar id={p.owner} name={name} size={26} />
          </Ring>
        </View>
        <CardName text={name} />
      </View>
    </Pressy>
  );
}

/** Mine, first: "Add status" with my photo and a +, or my newest one (the + still adds another). Hold: my status page. */
function MyCard({ mine, name, myId, onPress, onAdd, onPage }: { mine: StatusPerson | null | undefined; name: string; myId: string; onPress: () => void; onAdd: () => void; onPage: () => void }) {
  const t = useT();
  const { theme } = useLook();
  const last = mine?.items.at(-1);
  return (
    <Pressy onPress={onPress} onLongPress={last ? onPage : onAdd} label={last ? t.myStatus : t.addStatus} testID="my-status" style={{ borderRadius: 16 }}>
      <View style={{ width: CARD_W, height: CARD_H, borderRadius: 16, overflow: 'hidden', backgroundColor: theme.glass }}>
        {last ? (
          <>
            <CardPicture m={last} />
            <View style={{ position: 'absolute', top: 6, start: 6 }}>
              <Ring count={mine!.items.length} seen={false} color={theme.acc} muted={theme.faint} size={34}>
                <Avatar id={myId} name={name} size={26} />
              </Ring>
            </View>
            <CardName text={t.myStatus} />
          </>
        ) : (
          <>
            <View style={{ position: 'absolute', top: 0, start: 0, end: 0, height: CARD_H - 50, alignItems: 'center', justifyContent: 'center' }}>
              <Avatar id={myId} name={name} size={58} />
            </View>
            <Txt size={12.5} weight="700" align="center" lines={2} style={{ position: 'absolute', start: 6, end: 6, bottom: 10 }}>
              {t.addStatus}
            </Txt>
          </>
        )}
        {/* The +: add one (on the photo, or at the corner of my newest). */}
        <Pressy
          onPress={onAdd}
          label={t.addStatus}
          hitSlop={8}
          testID="my-status-add"
          style={last ? { position: 'absolute', top: 26, start: 26, borderRadius: 11 } : { position: 'absolute', top: CARD_H / 2 - 4, start: CARD_W / 2 + 10, borderRadius: 11 }}
        >
          <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: theme.acc, borderWidth: 2, borderColor: theme.glass, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="plus" size={12} color="#FFFFFF" stroke={3} />
          </View>
        </Pressy>
      </View>
    </Pressy>
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

/** The ring's size round a photo in the list. */
const RING = PHOTO + 10;

/** The ring around a picture: one piece per status, coloured until seen. */
function Ring({ count, seen, color, muted, size: wanted, children }: { count: number; seen: boolean; color: string; muted: string; size?: number; children: ReactNode }) {
  const size = wanted ?? RING;
  const r = size / 2 - 2;
  const round = 2 * Math.PI * r;
  // (Many statuses on a small ring: the gaps shrink so every piece still shows.)
  const gap = count > 1 ? Math.min(6, round / count / 3) : 0;
  const piece = count ? Math.max(1, round / count - gap) : round;
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
