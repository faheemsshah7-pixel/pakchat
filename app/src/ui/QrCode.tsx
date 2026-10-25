// QrCode.tsx: a QR code drawn on the phone (nothing is sent anywhere to make
// it). The squares are one path, so a big code is still quick to draw.
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { qrPath } from '../core/qr';

export function QrCode({ text, size, color = '#000000', background = '#FFFFFF' }: { text: string; size: number; color?: string; background?: string }) {
  const { d, n } = qrPath(text);
  // The quiet zone round the code that scanners need.
  const pad = 2;
  return (
    <View style={{ width: size, height: size, backgroundColor: background, borderRadius: 14, overflow: 'hidden' }} testID="qr-code">
      <Svg width={size} height={size} viewBox={`${-pad} ${-pad} ${n + pad * 2} ${n + pad * 2}`}>
        <Path d={d} fill={color} />
      </Svg>
    </View>
  );
}
