// (tabs)/status.tsx: Status, updates that last 24 hours.
//
// At the top, my status: tap to see it (or to add one), or use the pencil
// (words on a colour) and camera (a photo or video) buttons. Below, everyone
// else's: new ones first with a coloured ring, then the ones I've seen, then
// the ones I muted (hold a row to mute or unmute). Tap to watch.
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import Animated from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { core } from '../../core/core';
import { useAuth, useStatuses, usePeople } from '../../core/hooks';
import type { StatusPerson } from '../../core/status';
import { fill, useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { listTime } from '../../ui/format';
import { Avatar, IconButton, Pressy, Screen, Section, Txt } from '../../ui/kit';
import { rise } from '../../ui/motion';
import { MenuItem, Sheet } from '../../ui/overlays';

export default function Status() {
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

  return (
    <Screen bottom={false}>
      <View style={{ paddingTop: 18, paddingHorizontal: 20, paddingBottom: 6, flexDirection: 'row', alignItems: 'center' }}>
        <Txt size={27} weight="800" style={{ letterSpacing: -0.9, flex: 1 }}>
          {t.status}
        </Txt>
        <IconButton icon="lock" label={t.statusPrivacy} onPress={() => router.push('/settings/status-privacy')} color={theme.muted} testID="status-privacy" />
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 10, paddingBottom: 120 }}>
        <Animated.View entering={rise()}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 10, paddingVertical: 10 }}>
            <Pressy
              onPress={() => (mineCount ? router.push({ pathname: '/status/[id]', params: { id: mine!.chat.id } }) : router.push({ pathname: '/status-new', params: { kind: 'text' } }))}
              label={t.myStatus}
              scale={0.98}
              style={{ flex: 1 }}
              testID="my-status"
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Ring count={mineCount} seen={false} color={theme.acc} muted={theme.muted}>
                  <Avatar id={myId} name={me?.name ?? ''} size={50} />
                </Ring>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt size={16} weight="700">
                    {t.myStatus}
                  </Txt>
                  <Txt size={13} color={theme.muted} lines={1}>
                    {mineCount ? fill(t.statusUpdates, { n: mineCount, time: listTime(mine!.latest, t) }) : t.tapToAddStatus}
                  </Txt>
                </View>
              </View>
            </Pressy>
            <IconButton icon="text" label={t.textStatus} look="soft" size={42} iconSize={19} onPress={() => router.push({ pathname: '/status-new', params: { kind: 'text' } })} testID="status-text" />
            <IconButton icon="camera" label={t.photoStatus} look="soft" size={42} iconSize={20} onPress={() => router.push({ pathname: '/status-new', params: { kind: 'media' } })} testID="status-media" />
          </View>
        </Animated.View>

        {fresh.length > 0 && <Section title={t.recentUpdates} />}
        {fresh.map((p, i) => (
          <Row key={p.chat.id} p={p} i={i} onPress={() => open(p)} onLongPress={() => setHeld(p)} />
        ))}
        {seen.length > 0 && <Section title={t.viewedUpdates} />}
        {seen.map((p, i) => (
          <Row key={p.chat.id} p={p} i={i} onPress={() => open(p)} onLongPress={() => setHeld(p)} />
        ))}
        {muted.length > 0 && <Section title={t.mutedUpdates} />}
        {muted.map((p, i) => (
          <Row key={p.chat.id} p={p} i={i} onPress={() => open(p)} onLongPress={() => setHeld(p)} faded />
        ))}
        {all && !others.length && (
          <Txt size={14} color={theme.muted} align="center" style={{ marginTop: 40, paddingHorizontal: 30 }}>
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

function Row({ p, i, onPress, onLongPress, faded }: { p: StatusPerson; i: number; onPress: () => void; onLongPress: () => void; faded?: boolean }) {
  const t = useT();
  const { theme } = useLook();
  const name = core.name(p.owner) || '…';
  return (
    <Animated.View entering={i < 12 ? rise(i * 25) : undefined} style={{ opacity: faded ? 0.6 : 1 }}>
      <Pressy onPress={onPress} onLongPress={onLongPress} label={name} scale={0.98} testID="status-row">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 10, paddingVertical: 9 }}>
          <Ring count={p.items.length} seen={p.seen} color={theme.acc} muted={theme.muted}>
            <Avatar id={p.owner} name={name.replace(/^~ /, '')} size={50} />
          </Ring>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt size={16} weight="700" lines={1}>
              {name}
            </Txt>
            <Txt size={13} color={theme.muted}>
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
  const size = 60;
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
