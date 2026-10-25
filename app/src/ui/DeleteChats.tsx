// DeleteChats.tsx: deleting or clearing chats picked in the list, like WhatsApp.
// Delete takes a chat off the list with its messages (it comes back if
// someone writes). A group you're still in is exited first ("Exit and
// delete"); a community's announcements need the whole community exited, so
// those stay. Clear removes the messages and keeps the chat in the list.
// After leaving a group, LeftGroupChoices offers the same: delete or clear.
import { router } from 'expo-router';

import { core, isOffline } from '../core/core';
import type { ChatRow } from '../core/hooks';
import { fill, useT } from '../i18n';
import { Dialog, toast } from './overlays';

export function DeleteChats({ rows, mode, onClose }: { rows: ChatRow[]; mode: 'delete' | 'clear' | null; onClose: (done: boolean) => void }) {
  const t = useT();
  const inGroups = rows.filter((r) => r.chat.kind === 'group' && !r.chat.left && !r.chat.announcements);
  const stuck = rows.filter((r) => r.chat.kind === 'group' && !r.chat.left && r.chat.announcements);

  async function remove() {
    onClose(true);
    if (stuck.length) toast(t.exitCommunityFirst);
    try {
      for (const r of rows) {
        if (stuck.includes(r)) continue;
        if (inGroups.includes(r)) await core.client.removeMember(r.chat.id, core.myId);
        await core.deleteChatHere(r.chat.id);
      }
    } catch (err) {
      toast(isOffline(err) ? t.offline : t.couldNot);
    }
  }

  async function clear() {
    onClose(true);
    try {
      for (const r of rows) await core.clearChat(r.chat.id);
      toast(rows.length === 1 ? t.chatCleared : t.chatsCleared);
    } catch {
      toast(t.couldNot);
    }
  }

  const one = rows.length === 1;
  const exiting = inGroups.length > 0;
  return (
    <>
      {/* A group you're still in: clear it and stay, or exit and delete, like WhatsApp. */}
      <Dialog
        visible={mode === 'delete'}
        onClose={() => onClose(false)}
        title={one ? t.deleteChatOne : fill(t.deleteChats, { n: rows.length })}
        text={exiting ? (one ? t.groupDeleteChoice : fill(t.groupsDeleteChoice, { n: inGroups.length })) : t.deleteChatsGone}
        buttons={[
          { label: exiting ? t.exitAndDelete : t.delete, danger: true, testID: 'confirm-delete-chats', onPress: () => void remove() },
          ...(exiting ? [{ label: t.clearChat, testID: 'delete-or-clear', onPress: () => void clear() }] : []),
          { label: t.cancel, onPress: () => onClose(false) },
        ]}
      />
      <Dialog
        visible={mode === 'clear'}
        onClose={() => onClose(false)}
        title={one ? `${t.clearChat}?` : fill(t.clearChats, { n: rows.length })}
        text={t.clearChatNote}
        buttons={[
          { label: t.clearChat, danger: true, testID: 'confirm-clear-chats', onPress: () => void clear() },
          { label: t.cancel, onPress: () => onClose(false) },
        ]}
      />
    </>
  );
}

/** After leaving a group (or from its bar once left): delete it from the list, clear it, or keep it. */
export function LeftGroupChoices({ chatId, name, visible, justLeft, onClose }: { chatId: string; name: string; visible: boolean; justLeft?: boolean; onClose: () => void }) {
  const t = useT();
  return (
    <Dialog
      visible={visible}
      onClose={onClose}
      title={justLeft ? fill(t.youLeftName, { name }) : t.deleteGroup}
      text={t.leftChoicesNote}
      buttons={[
        {
          label: t.deleteGroup,
          danger: true,
          testID: 'left-delete',
          onPress: () => {
            onClose();
            void core
              .deleteChatHere(chatId)
              .then(() => router.dismissTo('/'))
              .catch(() => toast(t.couldNot));
          },
        },
        {
          label: t.clearChat,
          testID: 'left-clear',
          onPress: () => {
            onClose();
            void core
              .clearChat(chatId)
              .then(() => toast(t.chatCleared))
              .catch(() => toast(t.couldNot));
          },
        },
        { label: t.keepChat, onPress: onClose },
      ]}
    />
  );
}
