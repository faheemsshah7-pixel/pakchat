// calllink/[code].tsx: a call link, like WhatsApp's. Anyone with the link can
// join its call; it never rings anyone. Shows who's in the call now, Join with
// voice or video, and the link to share. Opened from the Calls tab, from a
// link someone sent (join/[code] first, if I'm not in it yet), or from a
// scheduled call's Join.
import { router, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Share, View } from 'react-native';

import { core, isOffline, serverUrl } from '../../core/core';
import { useCall, useChat, useLinkCall } from '../../core/hooks';
import { outsideFor } from '../../core/lock';
import { fill, useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { startCall } from '../../ui/CallBar';
import { Icon } from '../../ui/icons';
import { Avatar, Button, Divider, Glass, Screen, SettingRow, TopBar, Txt } from '../../ui/kit';
import { toast } from '../../ui/overlays';

export const callLinkUrl = (code: string) => `${serverUrl()}/calllink/${code}`;

export default function CallLink() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const t = useT();
  const { theme } = useLook();
  const [chatId, setChatId] = useState<string | null | undefined>(undefined);
  const chat = useChat(chatId ?? '');
  const live = useCall();
  const now = useLinkCall(chatId ?? null);

  // Which chat is this link's: one on this phone, or ask the server (not in it yet: join first).
  useEffect(() => {
    let alive = true;
    void (async () => {
      const here = (await core.client.chats()).find((c) => c.callLink && c.inviteCode === code && !c.left);
      if (here) return alive && setChatId(here.id);
      try {
        const info = await core.server.inviteInfo(code);
        const mine = await core.storage.getChat(info.chatId);
        if (mine && !mine.left) return alive && setChatId(mine.id);
        router.replace({ pathname: '/join/[code]', params: { code } });
      } catch (err) {
        if (isOffline(err)) toast(t.offline);
        if (alive) setChatId(null);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const link = callLinkUrl(code);
  const inIt = !!live && live.chatId === chatId && live.state !== 'ended';
  const people = now?.people ?? [];

  return (
    <Screen>
      <TopBar title={t.callLinkWord} onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      {chatId === undefined ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={theme.acc} />
        </View>
      ) : chatId === null || !chat ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Txt size={16} color={theme.muted} align="center" testID="calllink-gone">
            {t.linkNoLonger}
          </Txt>
        </View>
      ) : (
        <View style={{ padding: 14, gap: 12 }}>
          <View>
            <Glass strong style={{ padding: 22, borderRadius: 28, alignItems: 'center', gap: 10 }}>
              <View style={{ width: 84, height: 84, borderRadius: 28, backgroundColor: theme.accSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="link" size={38} color={theme.accInk} />
              </View>
              <Txt size={21} weight="800" align="center" testID="calllink-title">
                {core.chatTitle(chat)}
              </Txt>
              <Txt size={13.5} color={theme.muted} align="center" testID="calllink-who">
                {people.length ? fill(t.inCallNow, { names: people.map((u) => (u === core.myId ? t.youWord : core.name(u) || '…')).join(', ') }) : t.nobodyInCall}
              </Txt>
              {people.length > 0 && (
                <View style={{ flexDirection: 'row', gap: -8 }}>
                  {people.slice(0, 6).map((u) => (
                    <Avatar key={u} id={u} name={core.name(u)} size={34} />
                  ))}
                </View>
              )}
              {inIt ? (
                <Button title={t.backToCall} onPress={() => router.push({ pathname: '/call', params: { id: live.id } })} style={{ alignSelf: 'stretch', marginTop: 6 }} testID="calllink-back" />
              ) : (
                <View style={{ flexDirection: 'row', gap: 10, alignSelf: 'stretch', marginTop: 6 }}>
                  <Button title={t.joinVoice} icon="calls" onPress={() => void startCall(chatId, false, t)} style={{ flex: 1 }} testID="calllink-voice" />
                  <Button title={t.joinVideo} icon="video" onPress={() => void startCall(chatId, true, t)} style={{ flex: 1 }} testID="calllink-video" />
                </View>
              )}
            </Glass>
          </View>
          <View>
            <Glass>
              <View style={{ padding: 14 }}>
                <Txt size={14} weight="600" color={theme.accInk} selectable testID="calllink-url">
                  {link}
                </Txt>
                <Txt size={12.5} color={theme.muted}>
                  {t.callLinkNote}
                </Txt>
              </View>
              <Divider />
              <SettingRow
                icon="forward"
                title={t.shareLink}
                onPress={() => void outsideFor(() => Share.share({ message: fill(t.joinMyCall, { name: core.chatTitle(chat), link }) })).catch(() => {})}
                testID="calllink-share"
              />
              <Divider />
              <SettingRow
                icon="copy"
                title={t.copyLink}
                onPress={() => {
                  void Clipboard.setStringAsync(link);
                  toast(t.copied);
                }}
                testID="calllink-copy"
              />
            </Glass>
          </View>
        </View>
      )}
    </Screen>
  );
}
