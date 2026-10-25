// ReportSheet.tsx: Report, from a chat's info or ⋮ menu (or a held message).
// Pick why; the last few messages (at most 5) from this phone go with the
// report so PakChat can see what happened, as on WhatsApp: messages are locked
// end to end, so a report is the only way PakChat ever sees any. Then you can
// also block them, or leave the group.
import type { Message, ReportReason } from '@pakchat/shared';
import { useState } from 'react';
import { View } from 'react-native';

import { core } from '../core/core';
import { fill, useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { bodyLine } from './format';
import { Button, Pressy, Toggle, Txt } from './kit';
import { Sheet, toast } from './overlays';

const REASONS: ReportReason[] = ['spam', 'scam', 'abuse', 'other'];

export function ReportSheet({
  visible,
  chatId,
  group,
  userId,
  message,
  onClose,
}: {
  visible: boolean;
  chatId: string;
  group: boolean;
  /** The person reported (a one-to-one chat, or a group member). */
  userId: string | null;
  /** A held message: it goes first. */
  message?: Message | null;
  onClose: () => void;
}) {
  const t = useT();
  const { theme } = useLook();
  const [reason, setReason] = useState<ReportReason>('spam');
  const [also, setAlso] = useState(true);
  const [busy, setBusy] = useState(false);
  const words: Record<ReportReason, string> = { spam: t.reasonSpam, scam: t.reasonScam, abuse: t.reasonAbuse, other: t.reasonOther };
  const who = userId ? core.name(userId) || '…' : '';

  async function send() {
    setBusy(true);
    try {
      // Their latest messages here (or anyone's in a group), newest last.
      const recent = (await core.storage.listMessages(chatId, { limit: 60 })).filter((m) => m.kind !== 'system' && !m.deleted && m.author !== core.myId && (!userId || m.author === userId)).slice(-5);
      const list = message && !recent.some((m) => m.id === message.id && m.author === message.author) ? [...recent.slice(-4), message] : recent;
      await core.server.report(
        chatId,
        reason,
        userId,
        list.map((m) => ({ author: m.author, text: bodyLine(m, t).slice(0, 2000), at: m.sentAt })),
      );
      if (also) {
        if (group) await core.client.removeMember(chatId, core.myId);
        else if (userId) await core.block(userId, true);
      }
      toast(t.reported);
      onClose();
    } catch {
      toast(t.couldNot);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title={group ? t.reportGroup : fill(t.reportName, { name: who })}>
      <View style={{ paddingHorizontal: 16, gap: 10 }}>
        <Txt size={13.5} color={theme.muted}>
          {t.reportNote}
        </Txt>
        {REASONS.map((r) => (
          <Pressy key={r} onPress={() => setReason(r)} label={words[r]} scale={0.98} testID={`reason-${r}`}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 6 }}>
              <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: reason === r ? theme.acc : theme.faint, alignItems: 'center', justifyContent: 'center' }}>
                {reason === r && <View style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: theme.acc }} />}
              </View>
              <Txt size={15.5} weight={reason === r ? '700' : '500'}>
                {words[r]}
              </Txt>
            </View>
          </Pressy>
        ))}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 6, paddingVertical: 4 }}>
          <View style={{ flex: 1 }}>
            <Txt size={15} weight="600">
              {group ? t.alsoLeave : fill(t.alsoBlock, { name: who })}
            </Txt>
          </View>
          <Toggle on={also} onChange={setAlso} label={group ? t.alsoLeave : t.block} testID="report-also" />
        </View>
        <Button title={t.report} look="danger" busy={busy} onPress={() => void send()} testID="report-send" />
      </View>
    </Sheet>
  );
}
