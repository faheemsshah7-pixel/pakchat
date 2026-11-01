// Signs release APKs with PakChat's own private key (from build 15, 31 Oct), not
// React Native's public sample key that the Android template uses. The key and its
// passwords are never in git: a properties file outside the repo names them
// (gradle property pakchatSigning, or the project files folder by default). Without
// it, Android's build stops at checking the signing, so no APK is ever signed with
// the sample key again.
const { withAppBuildGradle } = require('expo/config-plugins');

const MARK = '// pakchat: release key (plugins/withReleaseKey.js)';

const RELEASE_CONFIG = `
        ${MARK}
        release {
            def props = new Properties()
            def f = new File(findProperty('pakchatSigning') ?: '/mnt/project-files/apps/pakchat/signing/pakchat-signing.properties')
            if (f.exists()) {
                f.withInputStream { props.load(it) }
                storeFile new File(f.parentFile, props['storeFile'])
                storePassword props['storePassword']
                keyAlias props['keyAlias']
                keyPassword props['keyPassword']
            }
        }`;

/** The app's build.gradle with the release key in. Throws if the template has changed shape. */
function addReleaseKey(src) {
  if (src.includes(MARK)) return src;
  const debugConfig = /(signingConfigs \{\s*debug \{[^}]*\})/;
  if (!debugConfig.test(src)) throw new Error('withReleaseKey: signingConfigs.debug not found in app/build.gradle');
  let out = src.replace(debugConfig, `$1${RELEASE_CONFIG}`);
  // The release build type: its signingConfig line (the template's says debug).
  const releaseType = /(buildTypes \{[\s\S]*?release \{[\s\S]*?)signingConfig signingConfigs\.debug/;
  if (!releaseType.test(out)) throw new Error('withReleaseKey: release buildType signingConfig not found in app/build.gradle');
  out = out.replace(releaseType, '$1signingConfig signingConfigs.release');
  return out;
}

module.exports = function withReleaseKey(config) {
  return withAppBuildGradle(config, (cfg) => {
    cfg.modResults.contents = addReleaseKey(cfg.modResults.contents);
    return cfg;
  });
};
module.exports.addReleaseKey = addReleaseKey;
