// app.config.js: app.json, plus the Firebase file when it's there.
// Alerts when PakChat is closed need google-services.json from your Firebase
// project (LEARN.md, "Phase 5: alerts"). Without it the app builds and works,
// just without those alerts.
const fs = require('fs');
const path = require('path');

module.exports = ({ config }) => {
  const firebase = path.join(__dirname, 'google-services.json');
  if (!fs.existsSync(firebase)) return config;
  return { ...config, android: { ...config.android, googleServicesFile: './google-services.json' } };
};
