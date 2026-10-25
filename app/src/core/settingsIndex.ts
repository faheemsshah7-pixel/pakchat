// settingsIndex.ts: every setting and the page it's on, for search in
// Settings (ui/SettingsSearch.tsx), like WhatsApp's.
import type { Href } from 'expo-router';

import type { Strings } from '../i18n/strings';
import type { IconName } from '../ui/icons';

export type Entry = { title: string; where: string; icon: IconName; to: Href | null };

/** Every setting, and the page it's on (null: the Settings page itself). */
function entries(t: Strings): Entry[] {
  const privacy = { where: t.privacy, to: '/settings/privacy' as const };
  const notifications = { where: t.notifications, to: '/settings/notifications' as const };
  const storage = { where: t.storage, to: '/settings/storage' as const };
  const lock = { where: t.appLock, to: '/settings/lock' as const };
  const backup = { where: t.backup, to: '/settings/backup' as const };
  const account = { where: t.signInWays, to: '/settings/account' as const };
  const here = { where: t.settings, to: null };
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
    { title: t.language, icon: 'globe', where: t.settings, to: '/settings/language' },
    { title: t.wallpaper, icon: 'wallpaper', where: t.chatsWord, to: '/wallpaper' },
    { title: t.appearance, icon: 'palette', ...here },
    { title: t.accentColour, icon: 'palette', ...here },
    { title: t.linkPreviews, icon: 'link', ...here },
    { title: t.keepArchived, icon: 'archive', ...here },
    { title: t.archiveAll, icon: 'archive', ...here },
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
