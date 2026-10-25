// (tabs)/communities.tsx: my communities, like WhatsApp's Communities tab.
//
// Each community is a card: its name, then its announcements group (where
// only admins post) and the groups of it I'm in, each with its latest message.
// Tap the name for the whole community (every group in it, and the ones I can
// join); tap a group to open it. "New community" sits at the top.
import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { useCommunities, type CommunityRow } from '../../core/hooks';
import { fill, useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { Icon } from '../../ui/icons';
import { GroupLine } from '../../ui/GroupLine';
import { Avatar, Empty, Glass, Pressy, Screen, Txt } from '../../ui/kit';
import { rise } from '../../ui/motion';

/** How many of a community's groups its card shows (the rest: "View all"). */
const SHOWN = 3;

export default function Communities() {
  const t = useT();
  const { theme } = useLook();
  const list = useCommunities();

  return (
    <Screen bottom={false}>
      <View style={{ paddingTop: 18, paddingHorizontal: 20, paddingBottom: 6 }}>
        <Txt size={27} weight="800" style={{ letterSpacing: -0.9 }}>
          {t.communities}
        </Txt>
      </View>
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 110, gap: 12 }}>
        <Animated.View entering={rise()}>
          <Pressy onPress={() => router.push('/new-community')} label={t.newCommunity} scale={0.98} testID="new-community">
            <Glass style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 22 }}>
              <View style={{ width: 52, height: 52, borderRadius: 18, backgroundColor: theme.accSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="community" size={26} color={theme.accInk} />
                <View
                  style={{
                    position: 'absolute',
                    end: -3,
                    bottom: -3,
                    width: 22,
                    height: 22,
                    borderRadius: 11,
                    backgroundColor: theme.acc,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 2,
                    borderColor: theme.bg,
                  }}
                >
                  <Icon name="plus" size={12} color="#FFFFFF" stroke={3} />
                </View>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt size={16.5} weight="700">
                  {t.newCommunity}
                </Txt>
                <Txt size={13} color={theme.muted}>
                  {t.newCommunitySub}
                </Txt>
              </View>
            </Glass>
          </Pressy>
        </Animated.View>

        {list && !list.length && <Empty icon="community" text={t.noCommunities} />}
        {(list ?? []).map((c, i) => (
          <Animated.View key={c.community.id} entering={i < 8 ? rise(60 + i * 40) : undefined}>
            <CommunityCard row={c} />
          </Animated.View>
        ))}
      </ScrollView>
    </Screen>
  );
}

function CommunityCard({ row }: { row: CommunityRow }) {
  const t = useT();
  const { theme } = useLook();
  const { community, groups } = row;
  const title = community.title ?? '';
  const open = () => router.push({ pathname: '/community/[id]', params: { id: community.id } });
  return (
    <Glass style={{ borderRadius: 22, overflow: 'hidden' }}>
      <Pressy onPress={open} label={title} scale={0.99} testID="community-card">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
          <Avatar id={community.id} name={title} size={48} group />
          <View style={{ flex: 1 }}>
            <Txt size={17} weight="800" lines={1}>
              {title}
            </Txt>
            <Txt size={12.5} color={theme.muted}>
              {fill(t.communityMembers, { n: community.members.length })}
            </Txt>
          </View>
          <Icon name="chevron" size={18} color={theme.faint} />
        </View>
      </Pressy>
      <View style={{ height: 1, backgroundColor: theme.glassLine, marginHorizontal: 14 }} />
      {groups.slice(0, SHOWN).map((g) => (
        <GroupLine key={g.chat.id} row={g} />
      ))}
      {groups.length > SHOWN && (
        <Pressy onPress={open} label={t.viewAll} scale={0.98} testID="community-view-all">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 }}>
            <View style={{ width: 40, alignItems: 'center' }}>
              <Icon name="chevron" size={18} color={theme.accInk} />
            </View>
            <Txt size={14.5} weight="700" color={theme.accInk}>
              {fill(t.viewAllGroups, { n: groups.length })}
            </Txt>
          </View>
        </Pressy>
      )}
    </Glass>
  );
}
