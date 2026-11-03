// The opening, like WhatsApp's: it follows light or dark (a soft light gray, or dark), with the
// logo in the middle and "PakChat" at the bottom (like WhatsApp's "from Meta"). The clock and
// battery at the top (and the buttons at the bottom) are drawn dark on the light one and white
// on the dark one, so they can always be read.
//
// PakChat's light or dark follows the phone, and so does the opening. Android is told never to
// darken PakChat by itself (forceDarkAllowed), since PakChat has its own dark look.
// Expo makes the android/ folder for us, so we change it here, not by hand.
const fs = require('fs');
const path = require('path');
const { withAndroidStyles, withDangerousMod, withMainApplication } = require('expo/config-plugins');

const BOOL = '@bool/splash_light_bars';
const DENSITIES = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];
const UNDO = "// pakchat: takes back build 23's whole-app light or dark (plugins/withSplashBars.js)";
const OLD_LOOK = '// pakchat: the opening follows the look picked in PakChat (plugins/withSplashBars.js)';

const item = (name, value, api) => ({ $: api ? { name, 'tools:targetApi': api } : { name }, _: value });

/** Sets one item in a style, replacing it if it's there. */
function put(style, name, value, api) {
  style.item = (style.item ?? []).filter((i) => i.$.name !== name);
  style.item.push(item(name, value, api));
}

function splashLooks(styles) {
  const list = styles.resources.style ?? [];
  const splash = list.find((s) => s.$.name === 'Theme.App.SplashScreen');
  if (!splash) return styles;
  put(splash, 'android:windowLightStatusBar', BOOL, '23');
  put(splash, 'android:windowLightNavigationBar', BOOL, '27');
  // Android 12 and newer draw a picture at the bottom of the opening (WhatsApp's "from Meta").
  put(splash, 'android:windowSplashScreenBrandingImage', '@drawable/splashscreen_brand', '31');

  // PakChat draws its own dark look: Android must never darken it by itself.
  const app = list.find((s) => s.$.name === 'AppTheme');
  if (app) put(app, 'android:forceDarkAllowed', 'false', '29');
  return styles;
}

function addUndo(src) {
  // An android/ folder made before build 24 still has build 23's line: replace it.
  src = src.replace(`    ${OLD_LOOK}\n    expo.modules.pakchatsignal.SplashLook.apply(this)\n`, '');
  if (src.includes(UNDO)) return src;
  const at = src.indexOf('    super.onCreate()\n');
  if (at < 0) throw new Error('withSplashBars: MainApplication.onCreate not found');
  const end = at + '    super.onCreate()\n'.length;
  return src.slice(0, end) + `    ${UNDO}\n    expo.modules.pakchatsignal.SplashLook.undoOld(this)\n` + src.slice(end);
}

const barsFile = (light) => `<resources>\n  <bool name="splash_light_bars">${light}</bool>\n</resources>\n`;

module.exports = (config) => {
  config = withAndroidStyles(config, (c) => {
    c.modResults = splashLooks(c.modResults);
    return c;
  });
  config = withMainApplication(config, (c) => {
    c.modResults.contents = addUndo(c.modResults.contents);
    return c;
  });
  return withDangerousMod(config, [
    'android',
    (c) => {
      const res = path.join(c.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res');
      const assets = path.join(c.modRequest.projectRoot, 'assets');
      for (const [night, look, light] of [['', 'light', true], ['-night', 'dark', false]]) {
        const values = path.join(res, `values${night}`);
        fs.mkdirSync(values, { recursive: true });
        fs.writeFileSync(path.join(values, 'splash_bars.xml'), barsFile(light));
        for (const d of DENSITIES) {
          // The name at the bottom follows the phone (drawable-night is the dark one).
          const dir = path.join(res, `drawable${night}-${d}`);
          fs.mkdirSync(dir, { recursive: true });
          fs.copyFileSync(path.join(assets, 'splash-brand', look, `${d}.png`), path.join(dir, 'splashscreen_brand.png'));
        }
      }
      return c;
    },
  ]);
};
module.exports.splashLooks = splashLooks;
module.exports.addUndo = addUndo;
