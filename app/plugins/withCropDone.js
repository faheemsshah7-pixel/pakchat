// The photo cropper (making a sticker, a profile photo) says "Done" on its
// button, not "Crop". The cropper is a library (android-image-cropper, through
// expo-image-picker); a word of the same name in the app's own resources
// replaces its, in English and in Urdu.
const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

const WORDS = { values: 'Done', 'values-ur': 'ہو گیا' };

module.exports = function withCropDone(config) {
  return withDangerousMod(config, [
    'android',
    async (c) => {
      const res = path.join(c.modRequest.platformProjectRoot, 'app/src/main/res');
      for (const [dir, word] of Object.entries(WORDS)) {
        fs.mkdirSync(path.join(res, dir), { recursive: true });
        fs.writeFileSync(
          path.join(res, dir, 'pakchat_crop.xml'),
          `<?xml version="1.0" encoding="utf-8"?>\n<!-- Made by plugins/withCropDone.js: change it there. -->\n<resources>\n    <string name="crop_image_menu_crop">${word}</string>\n</resources>\n`,
        );
      }
      return c;
    },
  ]);
};
