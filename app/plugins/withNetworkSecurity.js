// Release builds only talk HTTPS (security review, Nov 2026). Plain http:// is refused, except to
// the computer an emulator runs on (10.0.2.2) and the phone itself (localhost), which the tests
// use. The live server is https://pakchatapp.com, so nothing real changes; a link preview of an
// http:// page just shows no card. Debug builds still allow http, since they load their code from
// the Mac over the Wi-Fi.
// Expo makes the android/ folder for us, so we change it here, not by hand.
const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

const RELEASE = `<?xml version="1.0" encoding="utf-8"?>
<!-- pakchat: HTTPS only, except the emulator's Mac and the phone itself (plugins/withNetworkSecurity.js) -->
<network-security-config>
    <base-config cleartextTrafficPermitted="false" />
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">10.0.2.2</domain>
        <domain includeSubdomains="false">localhost</domain>
        <domain includeSubdomains="false">127.0.0.1</domain>
    </domain-config>
</network-security-config>
`;

const DEBUG = `<?xml version="1.0" encoding="utf-8"?>
<!-- pakchat: debug builds load their code from the Mac over http (plugins/withNetworkSecurity.js) -->
<network-security-config>
    <base-config cleartextTrafficPermitted="true" />
</network-security-config>
`;

/** The app's manifest pointing at the config, with the old allow-everything switch gone. */
function useConfig(manifest) {
  const app = manifest.manifest.application?.[0];
  if (!app) throw new Error('withNetworkSecurity: no <application> in AndroidManifest.xml');
  delete app.$['android:usesCleartextTraffic'];
  app.$['android:networkSecurityConfig'] = '@xml/network_security_config';
  return manifest;
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

module.exports = function withNetworkSecurity(config) {
  config = withAndroidManifest(config, (cfg) => {
    cfg.modResults = useConfig(cfg.modResults);
    return cfg;
  });
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const src = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src');
      write(path.join(src, 'main', 'res', 'xml', 'network_security_config.xml'), RELEASE);
      for (const debug of ['debug', 'debugOptimized']) {
        write(path.join(src, debug, 'res', 'xml', 'network_security_config.xml'), DEBUG);
      }
      return cfg;
    },
  ]);
};

module.exports.useConfig = useConfig;
module.exports.RELEASE = RELEASE;
module.exports.DEBUG = DEBUG;
