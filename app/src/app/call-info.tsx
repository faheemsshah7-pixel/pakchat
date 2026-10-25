// call-info.tsx: Call info, like WhatsApp's: who (or which group), buttons to
// message or call again, and each call of that row in the Calls tab: in or
// out (red when missed), voice or video, the time and how long it lasted.
// The bin at the top removes them from the list.
import { router, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { clearCallLog } from '../core/calls';
import { core } from '../core/core';
import { useCallLog, useChat } from '../core/hooks';
import { useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { startCall } from '../ui/CallBar';
import { clock, dayLabel, duration } from '../ui/format';
import { Icon, type IconName } from '../ui/icons';
import { Avatar, Glass, IconButton, Pressy, Screen, TopBar, Txt } from '../ui/kit';

export default function CallInfo() {
  const t = useT();
  const { theme } = useLook();
  const { chat: chatId, ids } = useLocalSearchParams<{ chat: string; ids: string }>();
  const chat = useChat(chatId);
  const wanted = (ids ?? '').split(',');
  const entries = (useCallLog() ?? []).filter((e) => wanted.includes(e.id));
  const group = !!entries[0]?.group;
  const person = !group ? (entries[0]?.with[0] ?? (chat ? core.otherPerson(chat) : null)) : null;
  const title = chat ? core.chatTitle(chat) : person ? core.name(person) : '…';

  const actions: { icon: IconName; label: string; on: () => void }[] = [
    { icon: 'chat', label: t.message, on: () => router.replace({ pathname: '/chat/[id]', params: { id: chatId } }) },
    { icon: 'calls', label: t.voiceCall, on: () => void startCall(chatId, false, t) },
    { icon: 'video', label: t.videoCall, on: () => void startCall(chatId, true, t) },
  ];

  return (
    <Screen>
      <TopBar
        title={t.callInfo}
        onBack={() => router.back()}
        right={
          <IconButton
            icon="trash"
            label={t.removeFromCallLog}
            onPress={() => {
              void clearCallLog(wanted);
              router.back();
            }}
            testID="call-info-remove"
          />
        }
      />
      <Glass style={{ marginHorizontal: 12, marginTop: 6, padding: 14, gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Avatar id={group ? chatId : (person ?? chatId)} name={title.replace(/^~ /, '')} size={52} group={group} />
          <Txt size={18} weight="700" lines={1} style={{ flex: 1 }} testID="call-info-title">
            {title}
          </Txt>
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {actions.map((a) => (
            <Pressy key={a.icon} onPress={a.on} label={a.label} scale={0.94} style={{ flex: 1 }}>
              <View style={{ alignItems: 'center', gap: 6, paddingVertical: 10, borderRadius: 16, backgroundColor: theme.accSoft }}>
                <Icon name={a.icon} size={20} color={theme.accInk} />
                <Txt size={12} weight="600" color={theme.accInk}>
                  {a.label}
                </Txt>
              </View>
            </Pressy>
          ))}
        </View>
      </Glass>

      {entries.length > 0 && (
        <Glass style={{ marginHorizontal: 12, marginTop: 14, paddingVertical: 6 }}>
          <Txt size={13} weight="700" color={theme.muted} style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
            {dayLabel(entries[0].at, t)}
          </Txt>
          {entries.map((e) => (
            <View key={e.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 }} testID="call-info-row">
              <Icon name={e.direction === 'in' ? 'callIn' : 'callOut'} size={18} color={e.missed ? '#E5484D' : theme.online} />
              <View style={{ flex: 1, gap: 2 }}>
                <Txt size={15} weight="600" color={e.missed ? '#E5484D' : theme.text}>
                  {e.missed ? t.missedWord : e.direction === 'in' ? t.incomingWord : t.outgoingWord}
                </Txt>
                <Txt size={13} color={theme.muted}>
                  {[clock(e.at), e.video ? t.videoCall : t.voiceCall].join(' · ')}
                </Txt>
              </View>
              {!!e.seconds && (
                <Txt size={13} color={theme.muted}>
                  {duration(e.seconds * 1000)}
                </Txt>
              )}
            </View>
          ))}
        </Glass>
      )}
    </Screen>
  );
}
