import { Text, StyleSheet, TouchableOpacity, View, useColorScheme, ScrollView, Image } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { AppIcons } from '../ui/appIcons';

type Row = {
  title: string;
  subtitle: string;
  icon: 'watch' | 'settings';
  screen: 'WatchSettings' | 'AppSettings';
};

const ROWS: Row[] = [
  {
    title: 'Watch',
    subtitle: 'Background, colors, and sync to Wear OS',
    icon: 'watch',
    screen: 'WatchSettings',
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
      <Text style={t.title}>Settings</Text>
      <Text style={t.sub}>Watch face options and app connection.</Text>

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
                <Ionicons name="settings-outline" size={22} color="#0d9488" />
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
    </ScrollView>
  );
}

const styles = (isDark: boolean) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: isDark ? '#0d1117' : '#f5f7fa' },
    content: { padding: 16, paddingBottom: 40 },
    title: { fontSize: 24, fontWeight: '700', color: isDark ? '#fff' : '#111' },
    sub: { marginTop: 4, marginBottom: 20, color: isDark ? '#9aa4b2' : '#667' },
    list: {
      backgroundColor: isDark ? '#161b22' : '#fff',
      borderRadius: 14,
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? '#30363d' : '#e5e7eb',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 14,
      paddingHorizontal: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: isDark ? '#30363d' : '#e5e7eb',
      gap: 12,
    },
    iconWrap: {
      width: 44,
      height: 44,
      borderRadius: 12,
      backgroundColor: isDark ? '#0d948820' : '#ccfbf1',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    iconImg: { width: 44, height: 44, borderRadius: 12 },
    rowText: { flex: 1 },
    rowTitle: { fontSize: 16, fontWeight: '600', color: isDark ? '#e6edf3' : '#111' },
    rowSub: { marginTop: 2, fontSize: 13, color: isDark ? '#8b949e' : '#6b7280' },
  });
