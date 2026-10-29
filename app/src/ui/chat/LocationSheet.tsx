// LocationSheet.tsx: Location in the attach menu. A map of where you are
// (drag it to pick another place), then:
//
//   Share live location     for 15 minutes, 1 hour or 8 hours (live.ts)
//   Send your location      where you are now (or the place the pin is on)
//
// Nothing is sent until you press one. The address comes from the phone.
import type { Place } from '@pakchat/shared';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Modal, useWindowDimensions, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { addressOf, LIVE_TIMES, whereAmI } from '../../core/live';
import { fill, useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { Icon } from '../icons';
import { Button, Glass, IconButton, Pressy, Txt } from '../kit';
import { toast } from '../overlays';
import { MapTiles } from './MapTiles';

export function LocationSheet({ visible, onClose, onSend, onLive }: { visible: boolean; onClose: () => void; onSend: (p: Place) => void; onLive: (ms: number) => void }) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      {visible && <Picker onClose={onClose} onSend={onSend} onLive={onLive} />}
    </Modal>
  );
}

function Picker({ onClose, onSend, onLive }: { onClose: () => void; onSend: (p: Place) => void; onLive: (ms: number) => void }) {
  const t = useT();
  const { theme } = useLook();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [here, setHere] = useState<{ lat: number; lng: number; accuracy: number | null } | null>(null);
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [where, setWhere] = useState<{ name?: string; address?: string }>({});
  const [failed, setFailed] = useState(false);
  const [times, setTimes] = useState(false);

  useEffect(() => {
    void whereAmI().then((p) => {
      if (!p) {
        setFailed(true);
        return;
      }
      setHere({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy });
      setPin({ lat: p.coords.latitude, lng: p.coords.longitude });
    });
  }, []);

  // The address under the pin, a moment after it stops.
  useEffect(() => {
    if (!pin) return;
    let live = true;
    const id = setTimeout(() => void addressOf(pin.lat, pin.lng).then((a) => live && setWhere(a)), 400);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [pin]);

  const moved = !!pin && !!here && (Math.abs(pin.lat - here.lat) > 1e-5 || Math.abs(pin.lng - here.lng) > 1e-5);
  const mapH = Math.round(height * 0.5);

  return (
    <View style={{ flex: 1, backgroundColor: theme.dark ? '#111214' : '#F4F7FC' }}>
      <View style={{ height: mapH + insets.top }}>
        {pin ? (
          <MapTiles lat={pin.lat} lng={pin.lng} width={width} height={mapH + insets.top} onMove={(lat, lng) => setPin({ lat, lng })}>
            {/* The pin stays in the middle; the map moves under it. */}
            <View pointerEvents="none" style={{ position: 'absolute', left: width / 2 - 18, top: (mapH + insets.top) / 2 - 40 }}>
              <Icon name="place" size={36} color={theme.acc} stroke={2.4} />
            </View>
            {here && (
              <View pointerEvents="none" style={{ position: 'absolute', left: width / 2 - 7, top: (mapH + insets.top) / 2 - 7, width: 14, height: 14, borderRadius: 7, backgroundColor: theme.acc, borderWidth: 2, borderColor: '#FFFFFF', opacity: moved ? 0 : 1 }} />
            )}
          </MapTiles>
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 30 }}>
            {failed ? (
              <>
                <Txt size={15} color={theme.muted} align="center">
                  {t.locationNeeded}
                </Txt>
                <Button title={t.openSettings} look="soft" onPress={() => void Linking.openSettings()} />
              </>
            ) : (
              <ActivityIndicator color={theme.acc} />
            )}
          </View>
        )}
        <View style={{ position: 'absolute', top: insets.top + 8, start: 10 }}>
          <IconButton icon="close" label={t.close} look="glass" onPress={onClose} testID="location-close" />
        </View>
        {moved && here && (
          <Animated.View style={{ position: 'absolute', bottom: 12, end: 12 }}>
            <IconButton icon="target" label={t.myLocation} look="glass" onPress={() => setPin({ lat: here.lat, lng: here.lng })} testID="location-recentre" />
          </Animated.View>
        )}
      </View>

      <View style={{ flex: 1, padding: 14, paddingBottom: insets.bottom + 14, gap: 10 }}>
        {pin && (
          <Animated.View style={{ gap: 10 }}>
            <Pressy onPress={() => setTimes(!times)} label={t.shareLive} scale={0.98} testID="location-live">
              <Glass style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18 }}>
                <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: '#18A86B22', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="live" size={22} color="#18A86B" />
                </View>
                <View style={{ flex: 1 }}>
                  <Txt size={15.5} weight="700">
                    {t.shareLive}
                  </Txt>
                  <Txt size={12.5} color={theme.muted}>
                    {t.shareLiveNote}
                  </Txt>
                </View>
              </Glass>
            </Pressy>
            {times && (
              <Animated.View style={{ flexDirection: 'row', gap: 8 }}>
                {LIVE_TIMES.map((ms) => (
                  <Button key={ms} title={ms < 3_600_000 ? fill(t.forMinutes, { n: ms / 60_000 }) : fill(ms === 3_600_000 ? t.forOneHour : t.forHours, { n: ms / 3_600_000 })} look="soft" style={{ flex: 1 }} onPress={() => onLive(ms)} testID={`live-${ms / 60_000}`} />
                ))}
              </Animated.View>
            )}
            <Pressy
              onPress={() => {
                if (!pin) return toast(t.couldNot);
                onSend({ lat: pin.lat, lng: pin.lng, ...(where.name ? { name: where.name.slice(0, 200) } : {}), ...(where.address ? { address: where.address.slice(0, 300) } : {}) });
              }}
              label={moved ? t.sendThisPlace : t.sendMyLocation}
              scale={0.98}
              testID="location-send"
            >
              <Glass style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18 }}>
                <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: theme.accSoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="place" size={22} color={theme.accInk} />
                </View>
                <View style={{ flex: 1 }}>
                  <Txt size={15.5} weight="700">
                    {moved ? t.sendThisPlace : t.sendMyLocation}
                  </Txt>
                  <Txt size={12.5} color={theme.muted} lines={2}>
                    {[where.name, where.address].filter(Boolean).join(' · ') || (here?.accuracy && !moved ? fill(t.accurateTo, { m: Math.round(here.accuracy) }) : '')}
                  </Txt>
                </View>
              </Glass>
            </Pressy>
          </Animated.View>
        )}
      </View>
    </View>
  );
}
