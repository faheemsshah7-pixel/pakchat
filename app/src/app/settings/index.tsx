// settings/index.tsx: Settings (from the chat list's ⋮ menu), laid out like
// WhatsApp's: you at the top (tap for your Profile, the QR for your code),
// then a plain list of pages. The 🔍 at the top searches every setting
// (ui/SettingsSearch.tsx), like WhatsApp.
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { BackHandler, ScrollView, View } from 'react-native';

import { useAuth } from '../../core/hooks';
import { useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import type { IconName } from '../../ui/icons';
import { Avatar, Divider, Field, Glass, IconButton, Pressy, Screen, SettingRow, TopBar, Txt } from '../../ui/kit';
import { SettingsResults } from '../../ui/SettingsSearch';

export default function Settings() {
  const t = useT();
  const { theme } = useLook();
  const { me, myId } = useAuth();
  // Search in Settings (🔍 at the top), like WhatsApp.
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const closeSearch = () => (setSearching(false), setQuery(''));

  // Back closes the search first.
  useEffect(() => {
    if (!searching) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setSearching(false);
      setQuery('');
      return true;
    });
    return () => sub.remove();
  }, [searching]);

  const pages: { icon: IconName; title: string; sub: string; to: Parameters<typeof router.push>[0]; testID: string }[] = [
    { icon: 'key', title: t.accountWord, sub: t.accountSub, to: '/settings/account', testID: 'open-account' },
    { icon: 'lock', title: t.privacy, sub: t.privacySub, to: '/settings/privacy', testID: 'open-privacy' },
    { icon: 'lists', title: t.listsWord, sub: t.listsSub, to: '/settings/lists', testID: 'open-lists' },
    { icon: 'chat', title: t.chatsWord, sub: t.chatsSettingsSub, to: '/settings/chats', testID: 'open-chats-settings' },
    { icon: 'bell', title: t.notifications, sub: t.notificationsSub, to: '/settings/notifications', testID: 'open-notifications' },
    { icon: 'database', title: t.storage, sub: t.storageSub, to: '/settings/storage', testID: 'open-storage' },
    { icon: 'globe', title: t.appLanguage, sub: t.languageSub, to: '/settings/language', testID: 'open-language' },
    { icon: 'info', title: t.helpWord, sub: t.helpSub, to: '/settings/help', testID: 'open-help' },
  ];

  return (
    <Screen>
      {searching ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingTop: 10, paddingBottom: 4 }}>
          <IconButton icon="back" label={t.back} onPress={closeSearch} flip testID="settings-search-close" />
          <View style={{ flex: 1 }}>
            <Field value={query} onChangeText={setQuery} placeholder={t.search} icon="search" autoFocus autoCorrect={false} returnKeyType="search" testID="settings-search" />
          </View>
        </View>
      ) : (
        <TopBar title={t.settings} onBack={() => router.back()} right={<IconButton icon="search" label={t.search} onPress={() => setSearching(true)} testID="settings-search-open" />} />
      )}
      {searching && !!query.trim() ? (
        <SettingsResults query={query} onHere={closeSearch} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 30 }}>
          {/* You: tap for your Profile; the QR for your code. */}
          <Pressy onPress={() => router.push('/settings/profile')} label={t.profileWord} scale={0.98} testID="edit-me">
            <Glass style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, marginTop: 8, borderRadius: 24 }}>
              <Avatar id={myId} name={me?.name ?? ''} size={64} />
              <View style={{ flex: 1, gap: 2 }}>
                <Txt size={19} weight="800" lines={1} testID="my-name">
                  {me?.name}
                </Txt>
                <Txt size={13.5} color={theme.muted} lines={1}>
                  {me?.about || t.aboutHint}
                </Txt>
              </View>
              <IconButton icon="qr" label={t.qrCode} look="soft" size={40} iconSize={20} onPress={() => router.push('/qr')} testID="my-qr" />
            </Glass>
          </Pressy>

          <Glass style={{ marginTop: 14 }}>
            {pages.map((p, i) => (
              <View key={p.testID}>
                {i > 0 && <Divider />}
                <SettingRow icon={p.icon} title={p.title} sub={p.sub} onPress={() => router.push(p.to)} testID={p.testID} />
              </View>
            ))}
          </Glass>
        </ScrollView>
      )}
    </Screen>
  );
}
