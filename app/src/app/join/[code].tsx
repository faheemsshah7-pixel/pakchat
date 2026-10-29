// join/[code].tsx: opened from an invite link (pakchat://join/<code>, or the
// server's web page for it). Shows the group or community, and Join (or
// Request to join, when a group's admins approve who joins).
import { REQUESTED, type InviteInfo } from '@pakchat/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { core, isOffline } from '../../core/core';
import { fill, useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { Avatar, Button, Glass, Screen, TopBar, Txt } from '../../ui/kit';
import { toast } from '../../ui/overlays';

export default function Join() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const t = useT();
  const { theme } = useLook();
  const [info, setInfo] = useState<InviteInfo | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState(false);

  useEffect(() => {
    void core.server
      .inviteInfo(code)
      .then(async (i) => {
        // Already in it: straight there.
        const mine = await core.storage.getChat(i.chatId);
        if (mine && !mine.left) return open(i, mine.id);
        setInfo(i);
      })
      .catch((err: unknown) => {
        if (isOffline(err)) toast(t.offline);
        setInfo(null);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  function open(i: InviteInfo, chatId: string) {
    if (i.callLink) router.replace({ pathname: '/calllink/[code]', params: { code } });
    else if (i.kind === 'community') router.replace({ pathname: '/community/[id]', params: { id: chatId } });
    else router.replace({ pathname: '/chat/[id]', params: { id: chatId } });
  }

  async function join() {
    if (!info) return;
    setBusy(true);
    try {
      const got = await core.server.joinInvite(code);
      // Its admins approve who joins: they've been asked.
      if (got === REQUESTED) {
        setAsked(true);
        setBusy(false);
        return;
      }
      const chat = await core.client.adopt(got);
      open(info, chat.id);
    } catch (err) {
      toast(isOffline(err) ? t.offline : t.linkNoLonger);
      setBusy(false);
    }
  }

  return (
    <Screen>
      <TopBar title={t.inviteLink} onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        {info === undefined ? (
          <ActivityIndicator color={theme.acc} />
        ) : info === null ? (
          <Txt size={16} color={theme.muted} align="center" testID="join-gone">
            {t.linkNoLonger}
          </Txt>
        ) : (
          <Animated.View style={{ alignSelf: 'stretch' }}>
            <Glass strong style={{ padding: 22, borderRadius: 28, alignItems: 'center', gap: 10 }}>
              <Avatar id={info.chatId} name={info.title} size={88} group />
              <Txt size={22} weight="800" align="center" testID="join-title">
                {info.title}
              </Txt>
              <Txt size={13.5} color={theme.muted} align="center">
                {info.callLink ? t.callLinkWord : fill(info.kind === 'community' ? t.communityMembers : t.groupMembers, { n: info.members })}
              </Txt>
              {!!info.description && (
                <Txt size={14} color={theme.sectionText} align="center">
                  {info.description}
                </Txt>
              )}
              {asked ? (
                <Txt size={14} weight="600" color={theme.accInk} align="center" style={{ marginTop: 8 }} testID="join-asked">
                  {t.requestSent}
                </Txt>
              ) : (
                <Button
                  title={info.callLink ? t.joinCall : info.kind === 'community' ? t.joinCommunity : info.approval ? t.requestToJoin : t.joinGroup}
                  busy={busy}
                  onPress={() => void join()}
                  style={{ alignSelf: 'stretch', marginTop: 8 }}
                  testID="join"
                />
              )}
            </Glass>
          </Animated.View>
        )}
      </View>
    </Screen>
  );
}
