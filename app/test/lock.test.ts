// Chat lock's Locked chats folder: a chat opened from it doesn't lock the
// folder behind it, and the folder locks again once you're back on the list.
import { beforeEach, expect, test, vi } from 'vitest';

vi.mock('expo-crypto', () => ({}));
vi.mock('expo-local-authentication', () => ({}));
vi.mock('react-native', () => ({ AppState: { addEventListener: () => ({ remove() {} }) } }));
vi.mock('../modules/pakchat-signal', () => ({ fileModule: () => ({}) }));
vi.mock('../src/core/core', () => ({ core: { settings: { chatRelock: 0, appLock: false }, emit() {} } }));

const lock = await import('../src/core/lock');
const { FOLDER } = lock;

beforeEach(() => {
  lock.leftFolder();
});

test('back from a chat opened in the folder: the folder is still open', () => {
  lock.openFolderByCode();
  lock.openWith('ali');
  lock.leftChat('ali');
  expect(lock.chatOpen(FOLDER)).toBe(true);
  expect(lock.chatOpen('ali')).toBe(false);
});

test('the folder screen going away under an open chat leaves the folder open', () => {
  lock.openFolderByCode();
  lock.openWith('ali');
  lock.leftChat(FOLDER);
  expect(lock.chatOpen(FOLDER)).toBe(true);
  lock.leftChat('ali');
  expect(lock.chatOpen(FOLDER)).toBe(true);
});

test('back on the chat list, the folder locks again', () => {
  lock.openFolderByCode();
  lock.openWith('ali');
  lock.leftChat('ali');
  lock.leftFolder();
  expect(lock.chatOpen(FOLDER)).toBe(false);
});

test('leaving the folder itself locks it', () => {
  lock.openFolderByCode();
  lock.leftChat(FOLDER);
  expect(lock.chatOpen(FOLDER)).toBe(false);
});
