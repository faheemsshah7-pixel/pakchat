// invite/[id].tsx: a group's (or community's) invite link, for its admins.
//
// Anyone with the link can see the group's name and join. It can stop by
// itself after a time (an hour, a day, a week, 30 days) or once so many people
// have joined. "New link" makes a fresh one, so the old one stops working.
import { router, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { ScrollView, Share, View } from 'react-native';

import { core, serverUrl } from '../../core/core';
import { useChat } from '../../core/hooks';
import { outsideFor } from '../../core/lock';
import { fill, useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { whenLabel } from '../../ui/format';
import { Avatar, Button, Chip, Divider, Glass, Screen, Section, SettingRow, TopBar, Txt } from '../../ui/kit';
import { Dialog, toast } from '../../ui/overlays';

const EXPIRES = [0, 3_600, 86_400, 7 * 86_400, 30 * 86_400];
const USES = [0, 1, 5, 10, 50, 100];

export const inviteUrl = (code: string) => `${serverUrl()}/join/${code}`;

export default function Invite() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const { theme } = useLook();
  const chat = useChat(id);
  const [expiresIn, setExpiresIn] = useState(0);
  const [maxUses, setMaxUses] = useState(0);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [now] = useState(Date.now);

  if (!chat) return <Screen>{null}</Screen>;
  const title = core.chatTitle(chat);
  const code = chat.inviteCode ?? null;
  const link = code ? inviteUrl(code) : null;
  const ended = !!code && ((!!chat.inviteExpiresAt && chat.inviteExpiresAt <= now) || (!!chat.inviteMaxUses && (chat.inviteUses ?? 0) >= chat.inviteMaxUses));

  async function make() {
    setBusy(true);
    try {
      await core.server.resetInvite(id, { expiresIn: expiresIn || undefined, maxUses: maxUses || undefined });
      await core.client.adopt(await core.server.chat(id));
      toast(t.newLinkMade);
    } catch {
      toast(t.couldNot);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setRemoving(false);
    setBusy(true);
    try {
      await core.server.removeInvite(id);
      await core.client.adopt(await core.server.chat(id));
    } catch {
      toast(t.couldNot);
    } finally {
      setBusy(false);
    }
  }

  const expiryLabel = (s: number) => (s === 0 ? t.neverWord : s === 3_600 ? t.oneHour : s === 86_400 ? t.oneDay : s === 7 * 86_400 ? t.sevenDays : t.thirtyDays);

  return (
    <Screen>
      <TopBar title={t.inviteLink} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 40, gap: 12 }}>
        <View>
          <Glass style={{ padding: 16, borderRadius: 22, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Avatar id={id} name={title} size={52} group />
              <View style={{ flex: 1 }}>
                <Txt size={16} weight="700" lines={1}>
                  {title}
                </Txt>
                <Txt size={12.5} color={theme.muted}>
                  {t.inviteNote}
                </Txt>
              </View>
            </View>
            {link ? (
              <>
                <Txt size={14.5} weight="600" color={ended ? theme.muted : theme.accInk} selectable testID="invite-url" style={{ textDecorationLine: ended ? 'line-through' : 'none' }}>
                  {link}
                </Txt>
                <Txt size={12.5} color={theme.muted} testID="invite-limits">
                  {[
                    ended ? t.linkEnded : chat.inviteExpiresAt ? fill(t.linkExpires, { when: whenLabel(chat.inviteExpiresAt, t) }) : t.linkNoExpiry,
                    chat.inviteMaxUses ? fill(t.linkUses, { n: chat.inviteUses ?? 0, max: chat.inviteMaxUses }) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Txt>
              </>
            ) : (
              <Txt size={14} color={theme.muted}>
                {t.noLinkYet}
              </Txt>
            )}
          </Glass>
        </View>

        {link && !ended && (
          <Glass>
            <SettingRow icon="forward" title={t.shareLink} onPress={() => void outsideFor(() => Share.share({ message: fill(t.joinMyGroup, { name: title, link }) })).catch(() => {})} testID="invite-share" />
            <Divider />
            <SettingRow
              icon="copy"
              title={t.copyLink}
              onPress={() => {
                void Clipboard.setStringAsync(link);
                toast(t.copied);
              }}
              testID="invite-copy"
            />
          </Glass>
        )}

        <Section title={t.linkStops} />
        <Glass style={{ padding: 14, gap: 14 }}>
          <View style={{ gap: 8 }}>
            <Txt size={13} weight="700" color={theme.sectionText}>
              {t.afterTime}
            </Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {EXPIRES.map((s) => (
                <Chip key={s} label={expiryLabel(s)} on={expiresIn === s} onPress={() => setExpiresIn(s)} testID={`expires-${s}`} />
              ))}
            </View>
          </View>
          <View style={{ gap: 8 }}>
            <Txt size={13} weight="700" color={theme.sectionText}>
              {t.afterJoins}
            </Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {USES.map((n) => (
                <Chip key={n} label={n === 0 ? t.noLimit : fill(t.nPeople, { n })} on={maxUses === n} onPress={() => setMaxUses(n)} testID={`uses-${n}`} />
              ))}
            </View>
          </View>
          <Button title={link ? t.newLink : t.makeLink} icon="link" busy={busy} onPress={() => void make()} testID="invite-make" />
        </Glass>

        {link && (
          <Glass>
            <SettingRow icon="trash" title={t.removeLink} danger chevron={false} onPress={() => setRemoving(true)} testID="invite-remove" />
          </Glass>
        )}
      </ScrollView>

      <Dialog
        visible={removing}
        onClose={() => setRemoving(false)}
        title={t.removeLink}
        text={t.removeLinkNote}
        buttons={[
          { label: t.removeLink, danger: true, onPress: () => void remove(), testID: 'invite-remove-yes' },
          { label: t.cancel, onPress: () => setRemoving(false) },
        ]}
      />
    </Screen>
  );
}
