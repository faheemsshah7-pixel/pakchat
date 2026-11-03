// The opening logo sits on solid blue: the clock and battery at the top (and the buttons at
// the bottom) are drawn white on it, not dark, so they can be read. Expo makes the android/
// folder for us, so we change its splash theme here, not by hand.
const { withAndroidStyles } = require('expo/config-plugins');

function lightBars(styles) {
  const splash = styles.resources.style?.find((s) => s.$.name === 'Theme.App.SplashScreen');
  if (!splash) return styles;
  splash.item = splash.item ?? [];
  for (const name of ['android:windowLightStatusBar', 'android:windowLightNavigationBar']) {
    if (!splash.item.some((i) => i.$.name === name)) splash.item.push({ $: { name, 'tools:targetApi': name.includes('Navigation') ? '27' : '23' }, _: 'false' });
  }
  return styles;
}

module.exports = (config) =>
  withAndroidStyles(config, (c) => {
    c.modResults = lightBars(c.modResults);
    return c;
  });
module.exports.lightBars = lightBars;
