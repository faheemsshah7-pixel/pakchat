// settings/profile.tsx: Settings › Profile (tap yourself at the top of
// Settings), like WhatsApp's. Your photo, big (tap the camera to change it),
// then Name, About and the number and Gmail you sign in with.
import { formatPhone } from '@pakchat/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { core } from '../../core/core';
import { useAuth } from '../../core/hooks';
import { useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { Avatar, Button, Divider, Field, Glass, Pressy, Screen, SettingRow, TopBar, Txt } from '../../ui/kit';
import { CameraBadge, PhotoSheet } from '../../ui/PhotoSheet';
import { Sheet, toast } from '../../ui/overlays';

export default function MyProfile() {
  const t = useT();
  const { theme } = useLook();
  const { me, myId } = useAuth();
  const [photoOpen, setPhotoOpen] = useState(false);
  const [editing, setEditing] = useState<'name' | 'about' | null>(null);
  const [text, setText] = useState('');

  const edit = (what: 'name' | 'about') => {
    setText((what === 'name' ? me?.name : me?.about) ?? '');
    setEditing(what);
  };

  async function save() {
    const what = editing;
    setEditing(null);
    if (!what) return;
    try {
      await core.updateMe(what === 'name' ? { name: text.trim() } : { about: text.trim() });
    } catch {
      toast(t.couldNot);
    }
  }

  return (
    <Screen>
      <TopBar title={t.profileWord} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 30 }}>
        <View style={{ alignItems: 'center', paddingVertical: 18 }}>
          <Pressy onPress={() => setPhotoOpen(true)} label={t.profilePhoto} scale={0.96} testID="my-photo">
            <Avatar id={myId} name={me?.name ?? ''} size={148} />
            <CameraBadge size={44} />
          </Pressy>
        </View>

        <Glass>
          <SettingRow icon="user" title={t.nameWord} sub={me?.name ?? ''} onPress={() => edit('name')} testID="profile-name" />
          <Divider />
          <SettingRow icon="info" title={t.about} sub={me?.about || t.aboutHint} onPress={() => edit('about')} testID="profile-about" />
          {!!me?.phone && (
            <>
              <Divider />
              <SettingRow icon="calls" title={t.phoneNumber} sub={formatPhone(me.phone)} chevron={false} testID="profile-phone" />
            </>
          )}
          {!!me?.email && (
            <>
              <Divider />
              <SettingRow icon="globe" title={t.emailWord} sub={me.email} chevron={false} testID="profile-email" />
            </>
          )}
        </Glass>
      </ScrollView>

      <Sheet visible={!!editing} onClose={() => setEditing(null)} title={editing === 'about' ? t.about : t.yourName}>
        <View style={{ paddingHorizontal: 18, paddingTop: 6, gap: 12 }}>
          <Field
            value={text}
            onChangeText={setText}
            placeholder={editing === 'about' ? t.aboutHint : t.yourName}
            maxLength={editing === 'about' ? 140 : 25}
            autoFocus
            testID={editing === 'about' ? 'me-about' : 'me-name'}
          />
          {editing === 'name' && (
            <Txt size={13} color={theme.muted}>
              {t.nameNote}
            </Txt>
          )}
          <Button title={t.save} onPress={save} disabled={editing === 'name' && !text.trim()} testID="me-save" />
        </View>
      </Sheet>

      <PhotoSheet visible={photoOpen} onClose={() => setPhotoOpen(false)} has={!!me?.photo} title={me?.name} />
    </Screen>
  );
}
