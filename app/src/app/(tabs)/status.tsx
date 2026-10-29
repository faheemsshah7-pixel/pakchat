// (tabs)/status.tsx: Status, updates that last 24 hours, like WhatsApp's.
//
// A sideways row of round photos: first "Add status" (me, with a +; tap to see
// mine, or to add one), then everyone else's: new ones first with a coloured
// ring, then the ones I've seen, then the ones I muted (faded; hold one to
// mute or unmute). Tap to watch. The pencil (words on a colour) and camera
// (a photo or video) at the top add one too.
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import Animated from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { core } from '../../core/core';
import { useAfterStart, useAuth, usePeople, useStatuses } from '../../core/hooks';
import type { StatusPerson } from '../../core/status';
import { useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { Icon } from '../../ui/icons';
import { Avatar, IconButton, Pressy, Screen, Txt } from '../../ui/kit';
import { MenuItem, Sheet } from '../../ui/overlays';

const PHOTO = 60;
const CELL = 76;

/** Drawn once the chat list has shown after starting (useAfterStart), so starting up draws that first. */
export default function StatusTab() {
  return useAfterStart() ? <Status /> : null;
}

function Status() {
  const t = useT();
  const { theme } = useLook();
  const { me, myId } = useAuth();
  const all = useStatuses();
  usePeople();
  const [held, setHeld] = useState<StatusPerson | null>(null);

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
        <IconButton icon="text" label={t.textStatus} onPress={() => router.push({ pathname: '/status-new', params: { kind: 'text' } })} color={theme.muted} testID="status-text" />
        <IconButton icon="camera" label={t.photoStatus} onPress={add} color={theme.muted} testID="status-media" />
        <IconButton icon="lock" label={t.statusPrivacy} onPress={() => router.push('/settings/status-privacy')} color={theme.muted} testID="status-privacy" />
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
        <View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 10, gap: 4 }} testID="status-row-list">
            {/* Add status: me, with a +. */}
            <Pressy
              onPress={() => (mineCount ? router.push({ pathname: '/status/[id]', params: { id: mine!.chat.id } }) : add())}
              onLongPress={add}
              label={mineCount ? t.myStatus : t.addStatus}
              scale={0.94}
              testID="my-status"
            >
              <View style={{ width: CELL, alignItems: 'center', gap: 6 }}>
                <View>
                  <Ring count={mineCount} seen={false} color={theme.acc} muted={theme.muted}>
                    <Avatar id={myId} name={me?.name ?? ''} size={PHOTO} />
                  </Ring>
                  <Pressy onPress={add} label={t.addStatus} scale={0.85} style={{ position: 'absolute', end: 0, bottom: 0 }} testID="add-status">
                    <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: theme.acc, borderWidth: 2, borderColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="plus" size={13} color="#FFFFFF" stroke={3} />
                    </View>
                  </Pressy>
                </View>
                <Txt size={12} weight="600" lines={1} align="center">
                  {mineCount ? t.myStatus : t.addStatus}
                </Txt>
              </View>
            </Pressy>
            {[...fresh, ...seen, ...muted].map((p, i) => (
              <StatusCircle key={p.chat.id} p={p} i={i} onPress={() => open(p)} onLongPress={() => setHeld(p)} />
            ))}
          </ScrollView>
        </View>
        {all && !others.length && (
          <Txt size={14} color={theme.muted} align="center" style={{ marginTop: 30, paddingHorizontal: 30 }}>
            {t.noStatuses}
          </Txt>
        )}
      </ScrollView>
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

/** One person in the row: their photo in its ring, and their name. */
function StatusCircle({ p, i, onPress, onLongPress }: { p: StatusPerson; i: number; onPress: () => void; onLongPress: () => void }) {
  const { theme } = useLook();
  const name = core.name(p.owner) || '…';
  return (
    <Animated.View style={{ opacity: p.muted ? 0.5 : 1 }}>
      <Pressy onPress={onPress} onLongPress={onLongPress} label={name} scale={0.94} testID="status-row">
        <View style={{ width: CELL, alignItems: 'center', gap: 6 }}>
          <Ring count={p.items.length} seen={p.seen || !!p.muted} color={theme.acc} muted={theme.faint}>
            <Avatar id={p.owner} name={name.replace(/^~ /, '')} size={PHOTO} />
          </Ring>
          <Txt size={12} weight={p.seen ? '400' : '600'} color={p.seen ? theme.muted : theme.text} lines={1} align="center">
            {name.replace(/^~ /, '')}
          </Txt>
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
