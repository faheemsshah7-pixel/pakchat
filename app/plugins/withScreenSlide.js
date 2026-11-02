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
// Opening any screen (the stack's "ios_from_right", _layout.tsx: chats, contact info,
// settings pages...) slides it in from the side, like build 17: see `slide` below.
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
 * Opening any screen (the stack's "ios_from_right", _layout.tsx): the new screen slides in from
 * the side while the one under it moves a little the other way, like build 17's (the owner
 * liked it better than build 18's zoom, 2 Nov). Polished: it moves the moment you tap and
 * slows smoothly into place, and BOTH screens use the same timing and curve, so they stay
 * together to the end (before, the screen underneath had Android's own curve and fell out of
 * step at the end, which looked off). Going back is the same slide, backwards, just as quick.
 * Urdu slides from the other side.
 */
function slide(fromX, toX, ms) {
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- Made by plugins/withScreenSlide.js: change it there. -->
<translate xmlns:android="http://schemas.android.com/apk/res/android"
    android:interpolator="@android:interpolator/decelerate_cubic"
    android:duration="${ms}"
    android:fromXDelta="${fromX}"
    android:toXDelta="${toX}" />
`;
}
// Build 17's length (Android's own short time, a fifth of a second) and its 30%: 19 had it a
// little longer, and opening a chat felt slower (owner's speed check, 2 Nov).
const OPEN_MS = 200;
const CLOSE_MS = 200;
/** How far the screen underneath moves (the new one covers it). */
const UNDER = 30;
for (const [side, dir] of [['right', 1], ['left', -1]]) {
  const away = `${dir * 100}%`;
  const under = `${-dir * UNDER}%`;
  Object.assign(FILES, {
    [`rns_ios_from_${side}_foreground_open.xml`]: slide(away, '0%', OPEN_MS),
    [`rns_ios_from_${side}_background_open.xml`]: slide('0%', under, OPEN_MS),
    [`rns_ios_from_${side}_foreground_close.xml`]: slide('0%', away, CLOSE_MS),
    [`rns_ios_from_${side}_background_close.xml`]: slide(under, '0%', CLOSE_MS),
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
