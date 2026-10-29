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
// Opening a chat (the stack's "ios_from_right" slide, _layout.tsx): its own
// starts slowly and speeds up, so for the first moment after a tap nothing
// seems to move. Like WhatsApp's, ours moves at once and slows into place.
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

/** A screen sliding in: quick at first, slowing into place, in a fifth of a second. Both screens move together. */
function slideIn(fromX, toX) {
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- Made by plugins/withScreenSlide.js: change it there. -->
<translate xmlns:android="http://schemas.android.com/apk/res/android"
    android:duration="@android:integer/config_shortAnimTime"
    android:interpolator="@android:interpolator/decelerate_cubic"
    android:fromXDelta="${fromX}"
    android:toXDelta="${toX}" />
`;
}
Object.assign(FILES, {
  'rns_ios_from_right_foreground_open.xml': slideIn('100%', '0%'),
  'rns_ios_from_right_background_open.xml': slideIn('0%', '-30%'),
  // Urdu: the same from the other side.
  'rns_ios_from_left_foreground_open.xml': slideIn('-100%', '0%'),
  'rns_ios_from_left_background_open.xml': slideIn('0%', '30%'),
});

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
