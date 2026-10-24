// Picture-in-picture for video calls (modules/pakchat-signal/.../CallPip.kt).
// Expo makes the android/ folder for us, so we change it here, not by hand:
//   1. The app's screen may shrink to a small window (supportsPictureInPicture).
//   2. MainActivity tells CallPip when you leave PakChat (Android 8 to 11 need
//      this to go small) and when the small window opens or closes.
const { withAndroidManifest, withMainActivity } = require('expo/config-plugins');

const MARK = '// pakchat: picture-in-picture (plugins/withCallPip.js)';

module.exports = function withCallPip(config) {
  config = withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    const main = app?.activity?.find((a) => a.$['android:name'] === '.MainActivity');
    if (main) main.$['android:supportsPictureInPicture'] = 'true';
    return cfg;
  });

  return withMainActivity(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (src.includes(MARK)) return cfg;
    src = src.replace(/\nimport android\.os\.Bundle\n/, '\nimport android.os.Bundle\nimport android.content.res.Configuration\n');
    const body = `
  ${MARK}
  override fun onUserLeaveHint() {
    super.onUserLeaveHint()
    expo.modules.pakchatsignal.CallPip.userLeaving(this)
  }

  override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
    super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
    expo.modules.pakchatsignal.CallPip.changed(isInPictureInPictureMode)
  }
`;
    // Into the class, just before its last closing brace.
    const end = src.lastIndexOf('}');
    cfg.modResults.contents = src.slice(0, end) + body + src.slice(end);
    return cfg;
  });
};
