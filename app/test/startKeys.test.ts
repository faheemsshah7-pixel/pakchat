// Starting PakChat: the encryption keys open at the same time as the saved names and
// settings are read (so the chat list comes sooner), but PakChat only counts as signed
// in, and so can send, open a chat or decrypt, once the keys are really open.
import { expect, test, vi } from 'vitest';

let keysOpen: (handle: unknown) => void = () => {};
const asked: string[] = [];
let settingsRead: () => void = () => {};

vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'id' }));
vi.mock('expo-device', () => ({ modelName: 'Test phone', isDevice: true }));
vi.mock('expo-file-system', () => ({ Directory: class {}, Paths: {} }));
vi.mock('expo-sqlite/kv-store', () => ({ default: { getItemSync: () => 'http://127.0.0.1:9', setItemSync() {} } }));
vi.mock('react-native', () => ({ AppState: { currentState: 'background', addEventListener: () => ({ remove() {} }) } }));
vi.mock('../modules/pakchat-signal', () => ({
  fileModule: () => ({}),
  loadSignal: () => ({
    openDevice: () => {
      asked.push('keys');
      return new Promise((r) => (keysOpen = r));
    },
  }),
}));
vi.mock('../src/core/db', () => ({
  openStorage: async () => ({
    getValue: (key: string) => {
      if (key === 'session') return Promise.resolve({ token: 't', userId: 'me', deviceId: 1, deviceUuid: 'u', me: { id: 'me' } });
      asked.push(key);
      // The settings answer only when the test says so.
      if (key === 'app:settings') return new Promise((r) => (settingsRead = () => r(null)));
      return Promise.resolve(null);
    },
    setValue: async () => {},
    deleteValue: async () => {},
    listChats: async () => [],
  }),
}));
vi.mock('../src/core/backup', () => ({ backUpIfDue: async () => {}, forgetBackup() {} }));
vi.mock('../src/core/calls', () => ({ calls: { onSignal() {}, on() {} } }));
vi.mock('../src/core/files', () => ({ forgetFile() {}, maybeDownload() {}, uploader: {} }));
vi.mock('../src/core/push', () => ({ alertFor() {}, alertReaction() {}, startPush: async () => {}, words: {} }));
vi.mock('../src/core/lock', () => ({ startLock() {} }));
vi.mock('../src/core/tones', () => ({ receivedTone() {}, sentTone() {} }));
vi.mock('@pakchat/shared', async (real) => ({
  ...(await real<typeof import('@pakchat/shared')>()),
  phoenixConnection: () => () => ({ open() {}, close() {} }),
}));

const { core } = await import('../src/core/core');
const tick = () => new Promise((r) => setTimeout(r, 0));

test('the keys start opening before the settings are read, and signed in waits for them', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const started = core.init();
  await tick();
  // Both are being read at once.
  expect(asked).toContain('keys');
  expect(asked).toContain('app:settings');

  // Settings done, keys not yet: not signed in, no session to send or decrypt with.
  settingsRead();
  await tick();
  expect(core.state).not.toBe('signedIn');
  expect(core.client.me).toBeNull();

  // Keys open: now signed in, with them.
  keysOpen('handle');
  await started;
  expect(core.state).toBe('signedIn');
  expect(core.client.me?.handle).toBe('handle');
  core.client.stop();
});
