// Release builds refuse plain http:// (plugins/withNetworkSecurity.js), except the emulator's
// Mac and the phone itself; app.json must not switch the old allow-everything flag back on.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const plugin = createRequire(__filename)('../plugins/withNetworkSecurity') as {
  useConfig: (m: { manifest: { application: { $: Record<string, string> }[] } }) => { manifest: { application: { $: Record<string, string> }[] } };
  RELEASE: string;
  DEBUG: string;
};
const appJson = JSON.parse(readFileSync(join(__dirname, '../app.json'), 'utf8'));

describe('https only in release', () => {
  it('points the manifest at the config and drops usesCleartextTraffic', () => {
    const out = plugin.useConfig({ manifest: { application: [{ $: { 'android:usesCleartextTraffic': 'true', 'android:label': '@string/app_name' } }] } });
    expect(out.manifest.application[0].$).toEqual({ 'android:label': '@string/app_name', 'android:networkSecurityConfig': '@xml/network_security_config' });
  });

  it('refuses http everywhere but the emulator and the phone itself', () => {
    expect(plugin.RELEASE).toContain('<base-config cleartextTrafficPermitted="false" />');
    const allowed = [...plugin.RELEASE.matchAll(/<domain[^>]*>([^<]+)<\/domain>/g)].map((m) => m[1]);
    expect(allowed).toEqual(['10.0.2.2', 'localhost', '127.0.0.1']);
    expect(plugin.DEBUG).toContain('cleartextTrafficPermitted="true"');
  });

  it('is in app.json, and the old switch is gone', () => {
    expect(appJson.expo.plugins).toContain('./plugins/withNetworkSecurity');
    expect(JSON.stringify(appJson)).not.toContain('usesCleartextTraffic');
  });
});
