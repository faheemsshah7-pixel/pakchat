// send-to.tsx: the chat list's 📷. What you just took (or picked from the
// gallery) waits here while you choose the chat; that chat then opens with the
// editor, so you can crop, draw and add a caption before it's sent.
import { router } from 'expo-router';
import { FlatList, View } from 'react-native';

import { dropHandOff } from '../core/files';
import { useChatList } from '../core/hooks';
import { useT } from '../i18n';
import { Avatar, Divider, Pressy, Screen, TopBar, Txt } from '../ui/kit';

export default function SendTo() {
  const t = useT();
  const rows = (useChatList() ?? []).filter((r) => !r.chat.left);

  return (
    <Screen>
      <TopBar
        title={t.sendTo}
        onBack={() => {
          dropHandOff();
          router.back();
        }}
      />
      <FlatList
        data={rows}
        keyExtractor={(r) => r.chat.id}
        contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
        ItemSeparatorComponent={Divider}
        renderItem={({ item, index }) => (
          <View>
            <Pressy onPress={() => router.replace({ pathname: '/chat/[id]', params: { id: item.chat.id, media: '1' } })} label={item.title} scale={0.98} testID={`send-to-${item.title}`}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 16 }}>
                <Avatar id={item.chat.id} name={item.title} size={44} group={item.chat.kind === 'group'} />
                <View style={{ flex: 1 }}>
                  <Txt size={15.5} weight="600">
                    {item.title}
                  </Txt>
                </View>
              </View>
            </Pressy>
          </View>
        )}
      />
    </Screen>
  );
}
