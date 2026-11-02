// How a new screen opens on Android, the same on every phone.
//
// We use Android's own "open a screen" animation (what WhatsApp gets too). But
// Android changed it in version 13: older phones zoom the new screen in, newer
// ones slide it in from the side. So on an older phone (a Realme 7i, say)
// PakChat zoomed while WhatsApp slid. Here we give older phones the new slide:
// the screen moves in a little from the side as it fades in.
//
// The animations belong to react-native-screens; a file of the same name in
// the app replaces its own (Android 13 and newer still use its originals,
// which can also stretch the edges, something older phones can't do).
//
// Opening a chat (the stack's "ios_from_right", _layout.tsx) zooms in like
// WhatsApp's: see `zoom` below.
const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

const EASE = '@android:interpolator/fast_out_slow_in';

/** One animation: a quick fade (or none), and a slide of the screen. */
function anim({ fromAlpha, toAlpha, alphaStart, alphaMs, fromX, toX }) {
  const fill = 'android:fillEnabled="true" android:fillBefore="true" android:fillAfter="true"';
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- Made by plugins/withScreenSlide.js: change it there. -->
<set xmlns:android="http://schemas.android.com/apk/res/android" android:shareInterpolator="false">
    <alpha android:fromAlpha="${fromAlpha}" android:toAlpha="${toAlpha}" ${fill}
        android:interpolator="@android:interpolator/linear" android:startOffset="${alphaStart}" android:duration="${alphaMs}" />
    <translate android:fromXDelta="${fromX}" android:toXDelta="${toX}" ${fill}
        android:interpolator="${EASE}" android:duration="450" />
</set>
`;
}

const FILES = {
  // Opening: the new screen fades in as it slides in; the old one slides a little the other way.
  'rns_default_enter_in.xml': anim({ fromAlpha: 0, toAlpha: 1, alphaStart: 50, alphaMs: 83, fromX: '10%', toX: '0' }),
  'rns_default_enter_out.xml': anim({ fromAlpha: 1, toAlpha: 1, alphaStart: 0, alphaMs: 450, fromX: '0', toX: '-10%' }),
  // Going back: the same, backwards.
  'rns_default_exit_in.xml': anim({ fromAlpha: 1, toAlpha: 1, alphaStart: 0, alphaMs: 450, fromX: '-10%', toX: '0' }),
  'rns_default_exit_out.xml': anim({ fromAlpha: 1, toAlpha: 0, alphaStart: 35, alphaMs: 83, fromX: '0', toX: '10%' }),
};

/**
 * Opening a chat (the stack's "ios_from_right", _layout.tsx), like WhatsApp's (owner's video,
 * 1 Nov): the new screen grows the last bit into place from a little smaller as it fades in,
 * over the screen under it, which stays put. Going back is the same, backwards: it shrinks a
 * little as it fades away. Before, it slid in from the side, and the end looked off.
 * Urdu (from the left) is the same, since a zoom has no side.
 */
function zoom({ fromScale, toScale, fromAlpha, toAlpha, ms, alphaMs, ease }) {
  const fill = 'android:fillEnabled="true" android:fillBefore="true" android:fillAfter="true"';
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- Made by plugins/withScreenSlide.js: change it there. -->
<set xmlns:android="http://schemas.android.com/apk/res/android" android:shareInterpolator="false">
    <alpha android:fromAlpha="${fromAlpha}" android:toAlpha="${toAlpha}" ${fill}
        android:interpolator="@android:interpolator/linear" android:duration="${alphaMs}" />
    <scale android:fromXScale="${fromScale}" android:toXScale="${toScale}" android:fromYScale="${fromScale}" android:toYScale="${toScale}"
        android:pivotX="50%" android:pivotY="50%" ${fill}
        android:interpolator="${ease}" android:duration="${ms}" />
</set>
`;
}
/** The screen underneath: it stays as it is (shown the whole time the other one moves). */
function stay(ms) {
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- Made by plugins/withScreenSlide.js: change it there. -->
<alpha xmlns:android="http://schemas.android.com/apk/res/android" android:fromAlpha="1" android:toAlpha="1" android:duration="${ms}" />
`;
}
const OPEN_MS = 220;
const CLOSE_MS = 180;
const open = zoom({ fromScale: 0.9, toScale: 1, fromAlpha: 0, toAlpha: 1, ms: OPEN_MS, alphaMs: 120, ease: '@android:interpolator/decelerate_cubic' });
const close = zoom({ fromScale: 1, toScale: 0.9, fromAlpha: 1, toAlpha: 0, ms: CLOSE_MS, alphaMs: CLOSE_MS, ease: '@android:interpolator/accelerate_cubic' });
for (const side of ['right', 'left']) {
  Object.assign(FILES, {
    [`rns_ios_from_${side}_foreground_open.xml`]: open,
    [`rns_ios_from_${side}_background_open.xml`]: stay(OPEN_MS),
    [`rns_ios_from_${side}_foreground_close.xml`]: close,
    [`rns_ios_from_${side}_background_close.xml`]: stay(CLOSE_MS),
  });
}

module.exports = function withScreenSlide(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const dir = path.join(cfg.modRequest.platformProjectRoot, 'app/src/main/res/anim');
      fs.mkdirSync(dir, { recursive: true });
      for (const [name, xml] of Object.entries(FILES)) fs.writeFileSync(path.join(dir, name), xml);
      return cfg;
    },
  ]);
};
module.exports.FILES = FILES;
