// forward.tsx: send picked messages on to other chats. They arrive marked
// "Forwarded", and each one is locked again for its new chat.
//
// Like WhatsApp: up to 5 chats at once, with the chats you write to most
// ("Frequently contacted") at the top, then the rest, newest first.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { core } from '../core/core';
import { forwardFile } from '../core/files';
import { useChatList, type ChatRow } from '../core/hooks';
import { fill, useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { Icon } from '../ui/icons';
import { Avatar, Button, Divider, Pressy, Screen, Section, TopBar, Txt } from '../ui/kit';
import { popIn, popOut } from '../ui/motion';
import { toast } from '../ui/overlays';

/** WhatsApp's limit: forwarding goes to at most this many chats at once. */
const MAX = 5;
/** "Frequently contacted": what I've written in the last four weeks. */
const LATELY = 28 * 86_400_000;

type Item = { kind: 'head'; key: string; title: string } | { kind: 'row'; key: string; row: ChatRow };

export default function Forward() {
  const { texts, files } = useLocalSearchParams<{ texts?: string; files?: string }>();
  const t = useT();
  const { theme } = useLook();
  const rows = (useChatList() ?? []).filter((r) => !r.chat.left);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [frequent, setFrequent] = useState<string[]>([]);
  useEffect(() => {
    void core.storage
      .frequentChats(core.myId, Date.now() - LATELY, 12)
      .then(setFrequent)
      .catch(() => {});
  }, []);
  // The chats I write to most (up to 5, and only ones in the list), then everything else.
  const top = frequent.map((id) => rows.find((r) => r.chat.id === id)).filter((r): r is ChatRow => !!r).slice(0, MAX);
  const rest = rows.filter((r) => !top.includes(r));
  const items: Item[] = top.length
    ? [
        { kind: 'head', key: 'head-frequent', title: t.frequentlyContacted },
        ...top.map((row) => ({ kind: 'row' as const, key: row.chat.id, row })),
        ...(rest.length ? [{ kind: 'head' as const, key: 'head-recent', title: t.recentChats }] : []),
        ...rest.map((row) => ({ kind: 'row' as const, key: row.chat.id, row })),
      ]
    : rows.map((row) => ({ kind: 'row' as const, key: row.chat.id, row }));
  const words: string[] = parse(texts);
  // Photos, videos and documents that are on this phone: [chatId, author, id] each.
  const refs: [string, string, string][] = parse(files);

  function toggle(id: string) {
    if (!picked.has(id) && picked.size >= MAX) return toast(t.forwardMax);
    setPicked((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX) next.add(id);
      return next;
    });
  }

  const [busy, setBusy] = useState(false);
  async function send() {
    // One tap sends once, even if the button is tapped again while sending.
    if (busy) return;
    setBusy(true);
    try {
      const toSend = (await Promise.all(refs.map(([c, a, i]) => core.storage.getMessage(c, a, i)))).filter((m) => !!m?.file?.local);
      for (const chatId of picked) {
        for (const w of words) await core.client.sendText(chatId, w, { forwarded: true });
        for (const m of toSend) await forwardFile(chatId, m!);
      }
      toast(t.forwardedNote);
      if (picked.size === 1) router.replace({ pathname: '/chat/[id]', params: { id: [...picked][0] } });
      else router.back();
    } catch {
      toast(t.couldNot);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <TopBar title={t.forwardTo} subtitle={fill(t.selected, { n: picked.size })} onBack={() => router.back()} />
      <FlatList
        data={items}
        extraData={picked}
        keyExtractor={(it) => it.key}
        contentContainerStyle={{ padding: 12, paddingBottom: 110 }}
        ItemSeparatorComponent={({ leadingItem }: { leadingItem?: Item }) => (leadingItem?.kind === 'row' ? <Divider /> : null)}
        renderItem={({ item: it }) => {
          if (it.kind === 'head') return <Section title={it.title} />;
          const item = it.row;
          const on = picked.has(item.chat.id);
          return (
            <View>
              <Pressy onPress={() => toggle(item.chat.id)} label={item.title} scale={0.98} testID={`forward-${item.title}`}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 16, backgroundColor: on ? theme.selected : 'transparent' }}>
                  <Avatar id={item.chat.id} name={item.title} size={44} group={item.chat.kind === 'group'} />
                  <View style={{ flex: 1 }}>
                    <Txt size={15.5} weight="600">
                      {item.title}
                    </Txt>
                  </View>
                  {on && (
                    <Animated.View entering={popIn} exiting={popOut} style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: theme.acc, alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="check" size={14} color="#FFFFFF" stroke={3} />
                    </Animated.View>
                  )}
                </View>
              </Pressy>
            </View>
          );
        }}
      />
      {picked.size > 0 && (
        <View style={{ position: 'absolute', start: 16, end: 16, bottom: 24 }}>
          <Button title={t.send} icon="send" onPress={send} busy={busy} testID="forward-send" />
        </View>
      )}
    </Screen>
  );
}

function parse<T>(json: string | undefined): T[] {
  try {
    return JSON.parse(json ?? '[]') as T[];
  } catch {
    return [];
  }
}
