// MapTiles.tsx: a small map made of OpenStreetMap's free tiles (256 px squares
// of the world at each zoom). No map SDK, no key and nothing to pay. It's used
// in the location picker (drag it to choose a place) and in location bubbles.
//
// OpenStreetMap asks apps to say who they are (the User-Agent) and to show
// "© OpenStreetMap" on the map.
import { Image } from 'expo-image';
import { useState } from 'react';
import { View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';

import { Txt } from '../kit';

const TILE = 256;
const HEADERS = { 'User-Agent': 'PakChat/1.0 (Android; chat app map tiles)' };

/** World pixels at a zoom for a place (Web Mercator). */
function toPixels(lat: number, lng: number, z: number) {
  const n = TILE * 2 ** z;
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return { x: ((lng + 180) / 360) * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
}

function toPlace(x: number, y: number, z: number) {
  const n = TILE * 2 ** z;
  const lng = (x / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return { lat, lng };
}

export function MapTiles({
  lat,
  lng,
  zoom = 16,
  width,
  height,
  onMove,
  children,
}: {
  lat: number;
  lng: number;
  zoom?: number;
  width: number;
  height: number;
  /** With this, dragging the map moves the middle (the pin) and says where it is when you let go. */
  onMove?: (lat: number, lng: number) => void;
  children?: React.ReactNode;
}) {
  const z = Math.round(zoom);
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const centre = toPixels(lat, lng, z);
  const cx = centre.x - drag.x;
  const cy = centre.y - drag.y;
  const left = cx - width / 2;
  const top = cy - height / 2;
  const max = 2 ** z;
  const tiles: { key: string; x: number; y: number; url: string }[] = [];
  for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + width) / TILE); tx++) {
    for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + height) / TILE); ty++) {
      if (ty < 0 || ty >= max) continue;
      const wx = ((tx % max) + max) % max;
      tiles.push({ key: `${tx}/${ty}`, x: tx * TILE - left, y: ty * TILE - top, url: `https://tile.openstreetmap.org/${z}/${wx}/${ty}.png` });
    }
  }

  const pan = usePanGesture({
    enabled: !!onMove,
    runOnJS: true,
    onUpdate: (e) => setDrag({ x: e.translationX, y: e.translationY }),
    onDeactivate: (e) => {
      const p = toPlace(centre.x - e.translationX, centre.y - e.translationY, z);
      setDrag({ x: 0, y: 0 });
      onMove?.(p.lat, p.lng);
    },
  });

  return (
    <GestureDetector gesture={pan}>
      <View style={{ width, height, overflow: 'hidden', backgroundColor: '#E8E4DA', direction: 'ltr' }}>
        {tiles.map((t) => (
          <Image key={t.key} source={{ uri: t.url, headers: HEADERS }} style={{ position: 'absolute', left: t.x, top: t.y, width: TILE, height: TILE }} cachePolicy="disk" transition={120} />
        ))}
        {children}
        <View pointerEvents="none" style={{ position: 'absolute', right: 0, bottom: 0, paddingHorizontal: 4, paddingVertical: 1, backgroundColor: 'rgba(255,255,255,0.75)', borderTopLeftRadius: 4 }}>
          <Txt size={8.5} color="#333">
            © OpenStreetMap
          </Txt>
        </View>
      </View>
    </GestureDetector>
  );
}
