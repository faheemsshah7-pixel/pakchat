// new-community.tsx: make a community. Give it a name (and a few words on what
// it's for), pick some of my groups to put in it if I like, then Create. The
// server makes its announcements group, where only admins post.
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { core, isOffline } from '../core/core';
import { useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { GroupPicker } from '../ui/GroupPicker';
import { Avatar, Button, Field, Glass, Screen, Section, TopBar, Txt } from '../ui/kit';
import { pop } from '../ui/motion';
import { toast } from '../ui/overlays';

export default function NewCommunity() {
  const t = useT();
  const { theme } = useLook();
  const [title, setTitle] = useState('');
  const [about, setAbout] = useState('');
  const [groups, setGroups] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const made = await core.client.adopt(await core.server.createCommunity(title.trim(), about.trim(), groups));
      // Its announcements group, and my groups now in it.
      await core.client.syncChats().catch(() => {});
      router.replace({ pathname: '/community/[id]', params: { id: made.id } });
    } catch (err) {
      toast(isOffline(err) ? t.offline : t.couldNot);
      setBusy(false);
    }
  }

  const toggle = (id: string) => setGroups((old) => (old.includes(id) ? old.filter((g) => g !== id) : [...old, id]));

  return (
    <Screen>
      <TopBar title={t.newCommunity} onBack={() => router.back()} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 12 }}>
        <View style={{ alignItems: 'center', marginVertical: 8 }}>
          <Animated.View entering={pop()}>
            <Avatar id={title || 'new-community'} name={title} size={96} group />
          </Animated.View>
        </View>
        <Txt size={13.5} color={theme.muted} align="center">
          {t.communityNote}
        </Txt>
        <Field value={title} onChangeText={setTitle} placeholder={t.communityName} maxLength={50} autoFocus testID="community-title" />
        <Field value={about} onChangeText={setAbout} placeholder={t.communityAbout} maxLength={500} testID="community-about" />
        <Section title={t.addYourGroups} />
        <Glass style={{ paddingVertical: 4 }}>
          <GroupPicker picked={groups} onToggle={toggle} />
        </Glass>
        <Button title={t.createCommunity} onPress={() => void create()} busy={busy} disabled={!title.trim()} testID="create-community" />
      </ScrollView>
    </Screen>
  );
}
