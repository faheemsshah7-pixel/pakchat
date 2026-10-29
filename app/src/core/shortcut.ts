// shortcut.ts: a chat on the phone's home screen, from the chat's ⋮ › Add
// shortcut, like WhatsApp (Shortcuts.kt asks the home screen). Its icon is the
// chat's photo, or the same initials the chat list shows; tapping it opens the chat.
import type { Chat } from '@pakchat/shared';

import { fileModule } from '../../modules/pakchat-signal';
import { avatarTint, initials } from '../ui/letters';
import { core } from './core';
import { photoUri } from './photos';

/** False if this phone's home screen can't take shortcuts. */
export function addShortcut(chat: Chat): boolean {
  const name = core.chatTitle(chat);
  const photo = photoUri(core.photoOf(chat.id));
  try {
    return fileModule().addShortcut(
      JSON.stringify({
        chatId: chat.id,
        name,
        photo: photo?.startsWith('file://') ? photo : '',
        avatar: { ...avatarTint(chat.id), letters: initials(name || '?') },
      }),
    );
  } catch {
    return false;
  }
}
