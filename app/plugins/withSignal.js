// Settings the Android build needs for Signal's library (libsignal).
// Expo makes the android/ folder for us, so we change it here, not by hand.
const { withAppBuildGradle, withProjectBuildGradle } = require('expo/config-plugins');

const REPO = "maven { url 'https://build-artifacts.signal.org/libraries/maven/'; content { includeGroup 'org.signal' } }";
const MARK = '// pakchat: settings for libsignal (plugins/withSignal.js)';

module.exports = function withSignal(config) {
  // 1. Signal publishes libsignal on their own Maven server, so add it to the list of places to look.
  config = withProjectBuildGradle(config, (cfg) => {
    const gradle = cfg.modResults.contents;
    if (!gradle.includes(REPO)) {
      cfg.modResults.contents = gradle.replace(/allprojects\s*\{\s*repositories\s*\{/, (m) => `${m}\n    ${REPO}`);
    }
    return cfg;
  });

  // 2. libsignal uses newer Java features than older Android phones have, so turn on
  //    "desugaring", which adds them to the app. (Our minimum is Android 7.)
  // 3. Keep out the parts of libsignal a phone never uses, so the APK stays small:
  //    the copy of its native code that's only for Signal's own tests, and the
  //    builds for computers (Mac, Windows, Linux) that come along with it.
  return withAppBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes(MARK)) {
      cfg.modResults.contents += `
${MARK}
android {
    compileOptions {
        coreLibraryDesugaringEnabled true
    }
    packagingOptions {
        jniLibs {
            excludes += ['**/libsignal_jni_testing.so']
        }
        resources {
            excludes += ['libsignal_jni*.so', 'libsignal_jni*.dylib', 'signal_jni*.dll']
        }
    }
}
dependencies {
    coreLibraryDesugaring 'com.android.tools:desugar_jdk_libs:2.1.5'
}
`;
    }
    return cfg;
  });
};
