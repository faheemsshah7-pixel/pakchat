// fix-webrtc.js: runs after npm install. Mends screen sharing in calls, in the
// WebRTC library (@livekit/react-native-webrtc, the same library as
// react-native-webrtc, kept up by LiveKit for group calls). Safe to run again:
// each is only changed once.
//
// 1. The shared screen's size and speed. A phone's whole screen (nearly 3000
//    pixels tall on a Pixel 8 Pro) is more than many phones' video chips can
//    encode, so the other phone saw a frozen picture. It's now at most 1280
//    pixels on its longer side, about what WhatsApp sends, both sides rounded
//    down to a multiple of 16 (odd sizes freeze too), at 20 frames a second
//    (not 30), plenty for a screen and much steadier on a mid-range phone.
// 2. The whole screen, never just one app: Android 14 and later offer "one app"
//    first, and that app's picture freezes once you leave it.
const fs = require('fs');
const path = require('path');
// eslint-disable-next-line no-undef
const dir = path.join(__dirname, '..', 'node_modules', '@livekit', 'react-native-webrtc', 'android', 'src', 'main', 'java', 'com', 'oney', 'WebRTCModule');
function mend(name, mark, change, done) {
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) return;
  const java = fs.readFileSync(file, 'utf8');
  if (java.includes(mark)) return;
  const after = change(java);
  if (!after) {
    console.warn(`fix-webrtc: the WebRTC library has changed (${name}); check screen sharing before building.`);
    return;
  }
  fs.writeFileSync(file, after);
  console.log(`fix-webrtc: ${done}`);
}

// Both places that read the screen's size get it made smaller, the same way.
const screenSize = /(final )?int (width|height) = displayMetrics\.(widthPixels|heightPixels);/g;
const fitted = (java) => java.replace(screenSize, (all, fin, side) => `${fin ?? ''}int ${side} = ScreenCaptureController.pakchatSize(displayMetrics.widthPixels, displayMetrics.heightPixels)[${side === 'width' ? 0 : 1}];`);

mend(
  'ScreenCaptureController.java',
  '// pakchat: screen sizes every phone can encode',
  (java) => {
    const fps = /private static final int DEFAULT_FPS = 30;/;
    if (!fps.test(java) || (java.match(screenSize) ?? []).length !== 2) return null;
    return fitted(java).replace(
      fps,
      [
        '// pakchat: screen sizes every phone can encode (at most 1280 on the longer side, multiples of 16), at 20 frames a second',
        '    private static final int DEFAULT_FPS = 20;',
        '',
        '    static int[] pakchatSize(int width, int height) {',
        '        float scale = Math.min(1f, 1280f / Math.max(width, height));',
        '        return new int[] { ((int) (width * scale)) & ~15, ((int) (height * scale)) & ~15 };',
        '    }',
      ].join('\n'),
    );
  },
  'screen sharing sizes made right for every phone.',
);

mend(
  'GetUserMediaImpl.java',
  '// pakchat: the whole screen',
  (java) => {
    const ask = 'mediaProjectionManager.createScreenCaptureIntent(), PERMISSION_REQUEST_CODE);';
    if (!java.includes(ask) || (java.match(screenSize) ?? []).length !== 2) return null;
    return fitted(java).replace(
      ask,
      [
        '// pakchat: the whole screen, never just one app (Android 14 and later)',
        '                            android.os.Build.VERSION.SDK_INT >= 34',
        '                                    ? mediaProjectionManager.createScreenCaptureIntent(android.media.projection.MediaProjectionConfig.createConfigForDefaultDisplay())',
        '                                    : mediaProjectionManager.createScreenCaptureIntent(),',
        '                            PERMISSION_REQUEST_CODE);',
      ].join('\n'),
    );
  },
  'screen sharing always shares the whole screen.',
);
