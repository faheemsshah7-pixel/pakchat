// Code shrinking (R8) keeps: adds proguard/native-keeps.pro (the classes native code
// finds by name) to the app's R8 rules, so a release build never strips them.
const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

const MARK = '# pakchat: native keeps (plugins/withNativeKeeps.js)';

module.exports = function withNativeKeeps(config) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const rules = path.join(cfg.modRequest.platformProjectRoot, 'app', 'proguard-rules.pro');
      const keeps = fs.readFileSync(path.join(cfg.modRequest.projectRoot, 'proguard', 'native-keeps.pro'), 'utf8');
      const now = fs.readFileSync(rules, 'utf8');
      if (!now.includes(MARK)) fs.writeFileSync(rules, `${now.trimEnd()}\n\n${MARK}\n${keeps}`);
      return cfg;
    },
  ]);
};
