// fix-webrtc.js: runs after npm install. Mends one line in react-native-webrtc
// that crashes screen sharing on Android 11 and older.
//
// The library waits for screen sharing's notification to start with
// CompletableFuture.orTimeout, which phones only have from Android 12. On older
// ones, pressing Share closed PakChat. The same 10 second wait is done here
// with a timer every Android has. Safe to run again: it only changes it once.
const fs = require('fs');
const path = require('path');

// eslint-disable-next-line no-undef
const file = path.join(__dirname, '..', 'node_modules', 'react-native-webrtc', 'android', 'src', 'main', 'java', 'com', 'oney', 'WebRTCModule', 'GetUserMediaImpl.java');
const MARK = '// pakchat: no orTimeout (Android 12+ only)';

if (!fs.existsSync(file)) process.exit(0);
const java = fs.readFileSync(file, 'utf8');
if (java.includes(MARK)) process.exit(0);

const before = /^([ \t]*)MediaProjectionService\.launch\(activity\)\s*\n\s*\.orTimeout\(10, TimeUnit\.SECONDS\)\s*\n/m;
const found = java.match(before);
if (!found) {
  console.warn('fix-webrtc: react-native-webrtc has changed; check screen sharing on Android 11 before building.');
  process.exit(0);
}
const pad = found[1];
const after = [
  `${pad}${MARK}`,
  `${pad}java.util.concurrent.CompletableFuture<Void> started = MediaProjectionService.launch(activity);`,
  `${pad}new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(`,
  `${pad}    () -> started.completeExceptionally(new java.util.concurrent.TimeoutException()), 10_000);`,
  `${pad}started`,
  '',
].join('\n');
fs.writeFileSync(file, java.replace(before, after));
console.log('fix-webrtc: screen sharing mended for Android 11 and older.');
