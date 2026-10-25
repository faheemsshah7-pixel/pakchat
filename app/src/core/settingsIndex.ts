// settingsIndex.ts: every setting and the page it's on, for search in
// Settings (ui/SettingsSearch.tsx), like WhatsApp's.
import type { Href } from 'expo-router';

import type { Strings } from '../i18n/strings';
import type { IconName } from '../ui/icons';

export type Entry = { title: string; where: string; icon: IconName; to: Href | null };

/** Every setting, and the page it's on. */
function entries(t: Strings): Entry[] {
  const privacy = { where: t.privacy, to: '/settings/privacy' as const };
  const notifications = { where: t.notifications, to: '/settings/notifications' as const };
  const storage = { where: t.storage, to: '/settings/storage' as const };
  const backup = { where: `${t.chatsWord} › ${t.backup}`, to: '/settings/backup' as const };
  const account = { where: t.accountWord, to: '/settings/account' as const };
  const chats = { where: t.chatsWord, to: '/settings/chats' as const };
  const lock = { where: `${t.privacy} › ${t.appLock}`, to: '/settings/lock' as const };
  return [
    { title: t.privacy, icon: 'lock', ...privacy },
    { title: t.lastSeenOnline, icon: 'eye', ...privacy },
    { title: t.profilePhoto, icon: 'photo', ...privacy },
    { title: t.readReceipts, icon: 'ticks', ...privacy },
    { title: t.defaultTimer, icon: 'timer', ...privacy },
    { title: t.blocked, icon: 'flag', where: t.privacy, to: '/settings/blocked' },
    { title: t.statusPrivacy, icon: 'status', where: t.privacy, to: '/settings/status-privacy' },
    { title: t.notifications, icon: 'bell', ...notifications },
    { title: t.notificationTone, icon: 'tone', ...notifications },
    { title: `${t.groups} · ${t.notificationTone}`, icon: 'group', ...notifications },
    { title: t.conversationTones, icon: 'speaker', ...notifications },
    { title: t.storage, icon: 'database', ...storage },
    { title: t.autoDownload, icon: 'download', ...storage },
    { title: t.lessDataCalls, icon: 'calls', ...storage },
    { title: t.appLock, icon: 'fingerprint', ...lock },
    { title: t.chatLock, icon: 'lock', ...lock },
    { title: t.hideLockedChats, icon: 'eye', ...lock },
    { title: t.secretCode, icon: 'key', ...lock },
    { title: t.backup, icon: 'archive', ...backup },
    { title: t.dailyBackup, icon: 'clock', ...backup },
    { title: t.backupPassword, icon: 'key', ...backup },
    { title: t.signInWays, icon: 'key', ...account },
    { title: t.linkGoogle, icon: 'globe', ...account },
    { title: t.linkPhone, icon: 'calls', ...account },
    { title: t.serverAddress, icon: 'server', ...account },
    { title: t.logOut, icon: 'logout', ...account },
    { title: t.profileWord, icon: 'user', where: t.settings, to: '/settings/profile' },
    { title: t.about, icon: 'info', where: t.profileWord, to: '/settings/profile' },
    { title: t.qrCode, icon: 'qr', where: t.settings, to: '/qr' },
    { title: t.appLanguage, icon: 'globe', where: t.settings, to: '/settings/language' },
    { title: t.listsWord, icon: 'lists', where: t.settings, to: '/settings/lists' },
    { title: t.manageStorage, icon: 'doc', where: t.storage, to: '/settings/manage-storage' },
    { title: t.helpWord, icon: 'info', where: t.settings, to: '/settings/help' },
    { title: t.appInfo, icon: 'info', where: t.helpWord, to: '/settings/help' },
    { title: t.chatsWord, icon: 'chat', ...chats },
    { title: t.themeWord, icon: 'palette', ...chats },
    { title: t.accentColour, icon: 'palette', ...chats },
    { title: t.wallpaper, icon: 'wallpaper', ...chats },
    { title: t.linkPreviews, icon: 'link', ...chats },
    { title: t.keepArchived, icon: 'archive', ...chats },
    { title: t.archiveAll, icon: 'archive', ...chats },
  ];
}

/** Lower case, without accents, for matching: "Last seen" matches "last", "seen", "las". */
const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function settingsMatching(query: string, t: Strings): Entry[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return entries(t).filter((e) => {
    const text = fold(`${e.title} ${e.where}`);
    return words.every((w) => text.includes(w));
  });
}
