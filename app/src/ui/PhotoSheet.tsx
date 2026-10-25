// PhotoSheet.tsx: change or remove a photo, like WhatsApp's: my profile photo,
// or (`chatId`) a group's or community's, for its admins. The photo is cropped
// square, made smaller and uploaded (core/photos.ts). With a photo, View photo
// shows it full screen.
import { router } from 'expo-router';
import { View } from 'react-native';

import { core, isOffline } from '../core/core';
import { pickPhoto, uploadPhoto } from '../core/photos';
import { useT } from '../i18n';
import { useLook } from '../theme/ThemeProvider';
import { Icon } from './icons';
import { MenuItem, Sheet, toast } from './overlays';

/** The little camera on a photo you can change (put it after the Avatar, inside its Pressy). */
export function CameraBadge({ size = 26 }: { size?: number }) {
  const { theme } = useLook();
  return (
    <View
      style={{
        position: 'absolute',
        end: -4,
        bottom: -4,
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: theme.acc,
        borderWidth: 2,
        borderColor: theme.dark ? theme.bg : '#FFFFFF',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name="camera" size={size / 2} color="#FFFFFF" stroke={2.2} />
    </View>
  );
}

export function PhotoSheet({ visible, onClose, has, chatId, title }: { visible: boolean; onClose: () => void; has: boolean; chatId?: string; title?: string }) {
  const t = useT();

  const save = async (photo: string) => {
    if (chatId) await core.client.updateGroup(chatId, { photo });
    else await core.updateMe({ photo });
  };

  async function choose() {
    onClose();
    try {
      const uri = await pickPhoto();
      if (!uri) return;
      toast(t.uploadingPhoto);
      await save(await uploadPhoto(uri, chatId));
      toast(t.photoUpdated);
    } catch (err) {
      toast(isOffline(err) ? t.offline : t.couldNot);
    }
  }

  async function remove() {
    onClose();
    try {
      await save('');
      toast(t.photoRemoved);
    } catch (err) {
      toast(isOffline(err) ? t.offline : t.couldNot);
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title={has ? t.changePhoto : t.addPhoto}>
      {has && (
        <MenuItem
          icon="eye"
          label={t.viewPhoto}
          onPress={() => (onClose(), router.push({ pathname: '/photo', params: { id: chatId ?? core.myId, title: title ?? '' } }))}
          testID="photo-view"
        />
      )}
      <MenuItem icon="photo" label={t.choosePhoto} onPress={() => void choose()} testID="photo-choose" />
      {has && <MenuItem icon="trash" label={t.removePhoto} danger onPress={() => void remove()} testID="photo-remove" />}
    </Sheet>
  );
}
