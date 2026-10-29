import { Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../auth/AuthContext';
import { openPainLog } from '../navigation';
import { HUD, IconWell, Label, Panel, Row, Screen, SectionHeader } from '../ui/hud';

export default function MeScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const initials = (user?.displayName || user?.email || '?')
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');

  return (
    <Screen title="Me">
      <Panel>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View
            style={{
              width: 52,
              height: 52,
              borderRadius: 16,
              borderWidth: 1.5,
              borderColor: HUD.cyan,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: HUD.panelRaised,
            }}
          >
            <Text style={{ color: HUD.cyan, fontFamily: HUD.fontCondensed, fontSize: 20, fontWeight: '700' }}>
              {initials}
            </Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: HUD.ink, fontSize: 18 }} numberOfLines={1}>
              {user?.displayName || 'Signed in'}
            </Text>
            <Text style={{ color: HUD.muted, fontSize: 13 }} numberOfLines={1}>
              {user?.email}
            </Text>
          </View>
          <IconWell name="shield-checkmark-outline" color={HUD.mint} />
        </View>
      </Panel>

      <SectionHeader title="Devices" />
      <Panel style={{ paddingVertical: 4 }}>
        <Row
          first
          icon="watch-outline"
          color={HUD.cyan}
          title="Watch"
          subtitle="Face, background and sync"
          chevron
          onPress={() => navigation.navigate('WatchSettings')}
        />
        <Row
          icon="fitness-outline"
          color={HUD.mint}
          title="Health and activity"
          subtitle="Samsung Health, Health Connect, workouts, injuries"
          chevron
          onPress={() => navigation.navigate('Activity')}
        />
      </Panel>

      <SectionHeader title="Wellbeing" />
      <Panel style={{ paddingVertical: 4 }}>
        <Row
          first
          icon="happy-outline"
          color={HUD.violet}
          title="Mind history"
          subtitle="Check-ins, stress, caffeine, Energy Score"
          chevron
          onPress={() => navigation.navigate('Mental')}
        />
        <Row
          icon="bandage-outline"
          color={HUD.red}
          title="Pain check-in"
          subtitle="Rate today's pain for each open injury"
          chevron
          onPress={() => openPainLog()}
        />
      </Panel>

      <SectionHeader title="App" />
      <Panel style={{ paddingVertical: 4 }}>
        <Row
          first
          icon="notifications-outline"
          color={HUD.amber}
          title="Reminders"
          subtitle="Morning check-in and nudges"
          chevron
          onPress={() => navigation.navigate('RemindersSettings')}
        />
        <Row
          icon="server-outline"
          color={HUD.inkSoft}
          title="Connection and account"
          subtitle="Server, device ID, sign out"
          chevron
          onPress={() => navigation.navigate('AppSettings')}
        />
      </Panel>

      <Label style={{ textAlign: 'center', marginTop: 8 }} color={HUD.dim}>
        Health Companion
      </Label>
    </Screen>
  );
}
