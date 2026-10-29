// fix-webrtc.js: runs after npm install. Mends two things in react-native-webrtc's
// screen sharing on Android. Safe to run again: each is only changed once.
//
// 1. The library waits for screen sharing's notification to start with
//    CompletableFuture.orTimeout, which phones only have from Android 12. On older
//    ones, pressing Share closed PakChat. The same 10 second wait is done here
//    with a timer every Android has.
// 2. The shared screen's size and speed. Scaled down, a screen came out at odd
//    sizes (575 × 1280 from a Pixel 8 Pro), which many phones' video chips can't
//    encode, so it fell back to slow software or froze. Both sides are now rounded
//    down to a multiple of 16, and it's captured at 20 frames a second (not 30),
//    plenty for a screen and much steadier on a mid-range phone.
const fs = require('fs');
const path = require('path');

// eslint-disable-next-line no-undef
const dir = path.join(__dirname, '..', 'node_modules', 'react-native-webrtc', 'android', 'src', 'main', 'java', 'com', 'oney', 'WebRTCModule');

function mend(name, mark, change, done) {
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) return;
  const java = fs.readFileSync(file, 'utf8');
  if (java.includes(mark)) return;
  const after = change(java);
  if (!after) {
    console.warn(`fix-webrtc: react-native-webrtc has changed (${name}); check screen sharing before building.`);
    return;
  }
  fs.writeFileSync(file, after);
  console.log(`fix-webrtc: ${done}`);
}

mend(
  'GetUserMediaImpl.java',
  '// pakchat: no orTimeout (Android 12+ only)',
  (java) => {
    const before = /^([ \t]*)MediaProjectionService\.launch\(activity\)\s*\n\s*\.orTimeout\(10, TimeUnit\.SECONDS\)\s*\n/m;
    const found = java.match(before);
    if (!found) return null;
    const pad = found[1];
    const after = [
      `${pad}// pakchat: no orTimeout (Android 12+ only)`,
      `${pad}java.util.concurrent.CompletableFuture<Void> started = MediaProjectionService.launch(activity);`,
      `${pad}new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(`,
      `${pad}    () -> started.completeExceptionally(new java.util.concurrent.TimeoutException()), 10_000);`,
      `${pad}started`,
      '',
    ].join('\n');
    return java.replace(before, after);
  },
  'screen sharing mended for Android 11 and older.',
);

mend(
  'ScreenCaptureController.java',
  '// pakchat: screen sizes every phone can encode',
  (java) => {
    const fps = /private static final int DEFAULT_FPS = 30;/;
    const sizes = /\(int\)\((width|height|displayMetrics\.widthPixels|displayMetrics\.heightPixels) \* resolutionScale\)/g;
    if (!fps.test(java) || (java.match(sizes) ?? []).length !== 4) return null;
    return java
      .replace(fps, '// pakchat: screen sizes every phone can encode (multiples of 16), at 20 frames a second\n    private static final int DEFAULT_FPS = 20;')
      .replace(sizes, (all) => `(${all} & ~15)`);
  },
  'screen sharing sizes rounded for every phone.',
);
