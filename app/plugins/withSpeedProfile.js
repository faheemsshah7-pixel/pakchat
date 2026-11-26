// The code Android should have ready before PakChat first runs (a "baseline profile").
// Without it, a newly installed PakChat runs much of React Native's own code in Android's slow
// step-by-step mode at first, and opening a chat stutters on a slower phone (the 38e recording:
// over half of the screen thread's time was spent that way). Android prepares the code listed
// here at install (or soon after), the way big apps do. Only what opening and scrolling chats,
// the tabs and the screens' slides use is listed, not the camera, calls or video players.
// Expo makes the android/ folder for us, so we write the list here, not by hand.
const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

const PACKAGES = [
  'com/facebook/react',
  'com/facebook/yoga',
  'com/facebook/jni',
  'com/facebook/soloader',
  'com/facebook/imagepipeline',
  'com/facebook/drawee',
  'com/facebook/fresco',
  'com/facebook/common',
  'com/facebook/imageformat',
  'com/swmansion',
  'com/shopify',
  'com/horcrux/svg',
  'com/bumptech/glide',
  'expo/modules/kotlin',
  'expo/modules/core',
  'expo/modules/adapters',
  'expo/modules/image',
  'expo/modules/lineargradient',
  'expo/modules/pakchatsignal',
  'com/pakchat',
  'kotlin',
  'kotlinx/coroutines',
  'androidx/core',
  'androidx/appcompat',
];

const TEXT =
  '# pakchat: code to have ready at install (plugins/withSpeedProfile.js)\n' +
  PACKAGES.map((p) => `HSPL${p}/**;->**(**)**\nL${p}/**;`).join('\n') +
  '\n';

module.exports = function withSpeedProfile(config) {
  return withDangerousMod(config, [
    'android',
    (c) => {
      const file = path.join(c.modRequest.platformProjectRoot, 'app', 'src', 'main', 'baseline-prof.txt');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, TEXT);
      return c;
    },
  ]);
};
