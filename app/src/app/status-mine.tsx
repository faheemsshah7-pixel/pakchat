// status-mine.tsx: My status, like WhatsApp's page: each of my statuses still up, with how
// many have seen it and when it went up. Tap one to watch it (and see who saw it); the bin
// deletes it for everyone.
import type { Message } from '@pakchat/shared';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { core } from '../core/core';
import { useStatuses } from '../core/hooks';
import { STATUS_BG, voiceColour } from '../core/status';
import { fill, useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { listTime } from '../ui/format';
import { Icon } from '../ui/icons';
import { IconButton, Pressy, Screen, TopBar, Txt } from '../ui/kit';
import { Dialog, toast } from '../ui/overlays';

export default function MyStatus() {
  const t = useT();
  const { theme } = useLook();
  const statuses = useStatuses();
  const mine = statuses?.mine;
  const [deleting, setDeleting] = useState<Message | null>(null);
  const items = [...(mine?.items ?? [])].reverse();
  return (
    <Screen>
      <TopBar title={t.myStatus} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ paddingVertical: 8 }}>
        {/* All deleted, or their 24 hours are up. */}
        {!!statuses && !items.length && (
          <Txt size={14.5} color={theme.muted} align="center" style={{ padding: 24 }} testID="my-status-empty">
            {t.noMyStatus}
          </Txt>
        )}
        {items.map((m) => {
          const views = (m.readBy ?? []).filter((u) => u !== core.myId).length;
          return (
            <Pressy key={m.id} onPress={() => router.push({ pathname: '/status/[id]', params: { id: m.chatId, at: m.id } })} label={listTime(m.sentAt, t)} scale={0.98} testID="my-status-item">
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 8 }}>
                <Small m={m} />
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Icon name="eye" size={15} color={theme.muted} />
                    <Txt size={15.5} weight="600">
                      {fill(t.seenByCount, { n: views })}
                    </Txt>
                  </View>
                  <Txt size={13.5} color={theme.muted}>
                    {listTime(m.sentAt, t)}
                  </Txt>
                </View>
                <IconButton icon="trash" label={t.deleteStatus} onPress={() => setDeleting(m)} color={theme.muted} testID="my-status-delete" />
              </View>
            </Pressy>
          );
        })}
        <Txt size={12.5} color={theme.muted} align="center" style={{ marginTop: 18, paddingHorizontal: 30 }}>
          {t.statusFor24}
        </Txt>
      </ScrollView>
      <Dialog
        visible={!!deleting}
        onClose={() => setDeleting(null)}
        title={t.deleteStatus}
        text={t.deleteStatusText}
        buttons={[
          {
            label: t.delete,
            danger: true,
            onPress: () => {
              const m = deleting;
              setDeleting(null);
              if (m) void core.client.deleteForEveryone(m.chatId, { author: m.author, id: m.id }).catch(() => toast(t.couldNot));
            },
          },
          { label: t.cancel, onPress: () => setDeleting(null) },
        ]}
      />
    </Screen>
  );
}

function Small({ m }: { m: Message }) {
  const f = m.file;
  const uri = f ? (f.local && f.kind === 'image' ? f.local : (f.poster ?? (f.thumb ? `data:image/jpeg;base64,${f.thumb}` : null))) : null;
  if (uri) return <Image source={{ uri }} style={{ width: 52, height: 52, borderRadius: 26 }} contentFit="cover" />;
  // A voice status: a mic on its colour.
  if (f?.kind === 'voice')
    return (
      <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: voiceColour(m.id), alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="mic" size={22} color="#FFFFFF" />
      </View>
    );
  return (
    <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: STATUS_BG[m.bg ?? 0] ?? STATUS_BG[0], alignItems: 'center', justifyContent: 'center', padding: 6, overflow: 'hidden' }}>
      <Txt size={9} weight="700" color="#FFFFFF" align="center" lines={3}>
        {m.text ?? ''}
      </Txt>
    </View>
  );
}
