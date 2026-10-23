// (tabs)/calls.tsx: every call, newest first, like WhatsApp's Calls tab.
//
// Each row: who, whether it came in or went out (a red arrow for a missed
// one), when, and how long. Tap the phone or camera on the end to call back;
// tap the row to open the chat; hold it to remove it from the list. The list
// is only on this phone (core/calls.ts keeps it).
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { clearCallLog, type CallLogEntry } from '../../core/calls';
import { core } from '../../core/core';
import { useCallLog, usePeople } from '../../core/hooks';
import { fill, useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { startCall } from '../../ui/CallBar';
import { duration, listTime } from '../../ui/format';
import { Icon } from '../../ui/icons';
import { Avatar, Empty, IconButton, Pressy, Screen, Txt } from '../../ui/kit';
import { rise } from '../../ui/motion';
import { Dialog } from '../../ui/overlays';

export default function Calls() {
  const t = useT();
  const { theme } = useLook();
  const list = useCallLog();
  usePeople();
  const [holding, setHolding] = useState<CallLogEntry | null>(null);
  const [clearing, setClearing] = useState(false);
  const [titles, setTitles] = useState<Record<string, string>>({});

  // Group names come from the chats (read once per group).
  const title = (e: CallLogEntry) => {
    if (!e.group) return core.name(e.with[0] ?? '') || '…';
    if (titles[e.chatId] === undefined) {
      void core.storage.getChat(e.chatId).then((c) => setTitles((old) => ({ ...old, [e.chatId]: c ? core.chatTitle(c) : t.groupWord })));
      return '…';
    }
    return titles[e.chatId];
  };

  return (
    <Screen bottom={false}>
      <View style={{ paddingTop: 18, paddingHorizontal: 20, paddingBottom: 6, flexDirection: 'row', alignItems: 'center' }}>
        <Txt size={27} weight="800" style={{ letterSpacing: -0.9, flex: 1 }}>
          {t.calls}
        </Txt>
        {!!list?.length && <IconButton icon="trash" label={t.clearCallLog} onPress={() => setClearing(true)} color={theme.muted} testID="clear-calls" />}
      </View>
      {list && !list.length ? (
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <Empty icon="calls" text={t.noCalls} />
        </View>
      ) : (
        <FlatList
          data={list ?? []}
          keyExtractor={(e) => e.id}
          contentContainerStyle={{ paddingHorizontal: 10, paddingBottom: 110 }}
          renderItem={({ item: e, index }) => (
            <Animated.View entering={index < 12 ? rise(index * 25) : undefined}>
              <Pressy onPress={() => router.push({ pathname: '/chat/[id]', params: { id: e.chatId } })} onLongPress={() => setHolding(e)} label={title(e)} scale={0.98} testID="call-row">
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 10, paddingVertical: 10 }}>
                  <Avatar id={e.group ? e.chatId : (e.with[0] ?? e.chatId)} name={e.group ? '' : title(e).replace(/^~ /, '')} size={50} group={e.group} />
                  <View style={{ flex: 1, gap: 3 }}>
                    <Txt size={16} weight="700" lines={1} color={e.missed ? '#E5484D' : theme.text}>
                      {title(e)}
                    </Txt>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                      <Icon name={e.direction === 'in' ? 'callIn' : 'callOut'} size={14} color={e.missed ? '#E5484D' : theme.online} />
                      <Txt size={13} color={theme.muted} lines={1}>
                        {[listTime(e.at, t), e.seconds ? duration(e.seconds * 1000) : e.missed ? t.missedWord : ''].filter(Boolean).join(' · ')}
                      </Txt>
                    </View>
                  </View>
                  <IconButton icon={e.video ? 'video' : 'calls'} label={fill(t.callBack, { name: title(e) })} look="soft" size={42} iconSize={20} onPress={() => void startCall(e.chatId, e.video, t)} testID="call-back" />
                </View>
              </Pressy>
            </Animated.View>
          )}
        />
      )}
      <Dialog
        visible={holding !== null}
        onClose={() => setHolding(null)}
        title={t.removeCall}
        text={holding ? title(holding) : ''}
        buttons={[
          {
            label: t.delete,
            danger: true,
            testID: 'confirm-remove-call',
            onPress: () => {
              if (holding) void clearCallLog([holding.id]);
              setHolding(null);
            },
          },
          { label: t.cancel, onPress: () => setHolding(null) },
        ]}
      />
      <Dialog
        visible={clearing}
        onClose={() => setClearing(false)}
        title={t.clearCallLog}
        text={t.clearCallLogText}
        buttons={[
          {
            label: t.clearCallLog,
            danger: true,
            testID: 'confirm-clear-calls',
            onPress: () => {
              void clearCallLog();
              setClearing(false);
            },
          },
          { label: t.cancel, onPress: () => setClearing(false) },
        ]}
      />
    </Screen>
  );
}
