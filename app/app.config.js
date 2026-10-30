// app.config.js: app.json, plus the Firebase file when it's there, and which copy this is (website or Play).
// Alerts when PakChat is closed need google-services.json from your Firebase
// project (LEARN.md, "Phase 5: alerts"). Without it the app builds and works,
// just without those alerts.
const fs = require('fs');
const path = require('path');

module.exports = ({ config }) => {
  // Which copy this is: "website" (the APK on our website, which checks it for updates,
  // see src/ui/UpdateCard.tsx) unless built for Google Play with PAKCHAT_CHANNEL=play.
  config = { ...config, extra: { ...config.extra, channel: process.env.PAKCHAT_CHANNEL === 'play' ? 'play' : 'website' } };
  const firebase = path.join(__dirname, 'google-services.json');
  if (!fs.existsSync(firebase)) return config;
  return { ...config, android: { ...config.android, googleServicesFile: './google-services.json' } };
};
