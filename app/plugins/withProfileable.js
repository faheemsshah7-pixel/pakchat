// Test builds only: lets the computer's speed tools see inside PakChat on a plugged-in phone
// (Android 10+ "profileable by shell"). Without it, a release build hides its own trace marks and
// a CPU profile can't look at it. It doesn't allow debugging or reading the app's data, and only
// works over a USB cable with USB debugging turned on. Expo makes the android/ folder, so we
// change it here, not by hand.
const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withProfileable(config) {
  return withAndroidManifest(config, (c) => {
    const app = c.modResults.manifest.application?.[0];
    if (!app) throw new Error('withProfileable: no <application> in AndroidManifest.xml');
    app.profileable = [{ $: { 'android:shell': 'true' } }];
    return c;
  });
};
