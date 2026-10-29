import { Text, StyleSheet, TouchableOpacity, View, useColorScheme, ScrollView, Image } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { AppIcons } from '../ui/appIcons';
import ScreenHero from '../components/ui/ScreenHero';
import { FadeIn } from '../components/ui/FadeIn';
import { HC, themeColors } from '../theme';

type Row = {
  title: string;
  subtitle: string;
  icon: 'watch' | 'settings' | 'notifications';
  screen: 'WatchSettings' | 'AppSettings' | 'RemindersSettings';
};

const ROWS: Row[] = [
  {
    title: 'Watch',
    subtitle: 'Face, background, colors and sync to Wear OS',
    icon: 'watch',
    screen: 'WatchSettings',
  },
  {
    title: 'Reminders',
    subtitle: 'Daily 10:30 check-in & weight nudge',
    icon: 'notifications',
    screen: 'RemindersSettings',
  },
  {
    title: 'Settings',
    subtitle: 'API connection and device ID',
    icon: 'settings',
    screen: 'AppSettings',
  },
];

export default function SettingsHubScreen() {
  const isDark = useColorScheme() === 'dark';
  const nav = useNavigation<any>();
  const t = styles(isDark);

  return (
    <ScrollView style={t.root} contentContainerStyle={t.content}>
      <ScreenHero
        eyebrow="PREFERENCES"
        title="Settings"
        subtitle="Watch, reminders, and app connection."
        pills={['Watch', 'Reminders', 'API']}
        compact
      />

      <FadeIn>
        <View style={t.list}>
          {ROWS.map((row) => (
            <TouchableOpacity
              key={row.screen}
              style={t.row}
              onPress={() => nav.navigate(row.screen)}
              activeOpacity={0.75}
            >
              <View style={t.iconWrap}>
                {row.icon === 'settings' ? (
                  <Ionicons name="settings-outline" size={22} color={HC.teal} />
                ) : row.icon === 'notifications' ? (
                  <Ionicons name="notifications-outline" size={22} color={HC.teal} />
                ) : (
                  <Image source={AppIcons.watch} style={t.iconImg} />
                )}
              </View>
              <View style={t.rowText}>
                <Text style={t.rowTitle}>{row.title}</Text>
                <Text style={t.rowSub}>{row.subtitle}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={isDark ? '#6e7681' : '#9ca3af'} />
            </TouchableOpacity>
          ))}
        </View>
      </FadeIn>
    </ScrollView>
  );
}

const styles = (isDark: boolean) => {
  const c = themeColors(isDark);
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    content: { paddingBottom: 40 },
    list: {
      backgroundColor: c.card,
      borderRadius: HC.radius.lg,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: c.border,
      marginHorizontal: 16,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 14,
      paddingHorizontal: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
      gap: 12,
    },
    iconWrap: {
      width: 44,
      height: 44,
      borderRadius: 12,
      backgroundColor: isDark ? '#0d948820' : HC.tealWash,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    iconImg: { width: 44, height: 44, borderRadius: 12 },
    rowText: { flex: 1 },
    rowTitle: { fontSize: 16, fontWeight: '700', color: c.ink },
    rowSub: { marginTop: 2, fontSize: 13, color: c.muted },
  });
};
