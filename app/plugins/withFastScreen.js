// The phone's fast screen mode (90 or 120 times a second) for PakChat, like WhatsApp.
// Android only gives an app the fast mode when it asks for it on many phones (Infinix,
// Realme, Tecno and others keep the rest at 60), so MainActivity asks for the fastest
// mode at the screen's own size. Battery saver and the phone's own settings still win.
// Expo makes the android/ folder for us, so we change it here, not by hand.
const { withMainActivity } = require('expo/config-plugins');

const MARK = '// pakchat: fast screen (plugins/withFastScreen.js)';

function addFastScreen(src) {
  if (src.includes(MARK)) return src;
  src = src.replace('super.onCreate(null)\n', 'super.onCreate(null)\n    useFastScreen()\n');
  const body = `
  ${MARK}
  private fun useFastScreen() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
    try {
      @Suppress("DEPRECATION")
      val shown = (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) display else windowManager.defaultDisplay) ?: return
      val now = shown.mode
      val best = shown.supportedModes
        .filter { it.physicalWidth == now.physicalWidth && it.physicalHeight == now.physicalHeight }
        .maxByOrNull { it.refreshRate } ?: return
      val attrs = window.attributes
      attrs.preferredDisplayModeId = best.modeId
      window.attributes = attrs
    } catch (e: Throwable) {}
  }
`;
  const end = src.lastIndexOf('}');
  return src.slice(0, end) + body + src.slice(end);
}

module.exports = function withFastScreen(config) {
  return withMainActivity(config, (cfg) => {
    cfg.modResults.contents = addFastScreen(cfg.modResults.contents);
    return cfg;
  });
};
module.exports.addFastScreen = addFastScreen;
