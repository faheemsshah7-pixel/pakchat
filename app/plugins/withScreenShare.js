// Calls' setup as the app starts. LiveKit's (group calls, core/groupCall.ts) sets up
// the WebRTC library's sound for calls, and screen sharing (core/calls.ts
// shareScreen), like WhatsApp: Android only lets an app capture the screen while
// it shows a "sharing" alert (a foreground service of the mediaProjection kind).
// The library brings that service and LiveKit's setup turns it on; Android 14
// wants the app to ask for that kind of service too.
const { AndroidConfig, withAndroidManifest, withMainApplication } = require('expo/config-plugins');

const MARK = '// pakchat: calls\' sound, group calls and screen sharing (plugins/withScreenShare.js)';

module.exports = function withScreenShare(config) {
  config = withAndroidManifest(config, (cfg) => {
    AndroidConfig.Permissions.ensurePermissions(cfg.modResults, ['android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION']);
    return cfg;
  });

  return withMainApplication(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (src.includes(MARK)) return cfg;
    const at = src.indexOf('    super.onCreate()\n');
    if (at < 0) throw new Error('withScreenShare: MainApplication.onCreate not found');
    const end = at + '    super.onCreate()\n'.length;
    src = src.slice(0, end) + `    ${MARK}\n    com.livekit.reactnative.LiveKitReactNative.setup(this)\n` + src.slice(end);
    cfg.modResults.contents = src;
    return cfg;
  });
};
