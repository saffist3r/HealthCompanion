import { ScrollView, StyleSheet, Text, useColorScheme } from 'react-native';
import { BackgroundSettingsCard } from '../components/BackgroundSettingsCard';

export default function WatchSettingsScreen() {
  const isDark = useColorScheme() === 'dark';
  const t = styles(isDark);

  return (
    <ScrollView style={t.root} contentContainerStyle={t.content}>
      <Text style={t.title}>Watch</Text>
      <Text style={t.sub}>
        Customize the Wear OS face background and text. Changes sync over Bluetooth when the watch
        is nearby.
      </Text>
      <BackgroundSettingsCard isDark={isDark} />
    </ScrollView>
  );
}

const styles = (isDark: boolean) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: isDark ? '#0d1117' : '#f5f7fa' },
    content: { padding: 16, paddingBottom: 40 },
    title: { fontSize: 24, fontWeight: '700', color: isDark ? '#fff' : '#111' },
    sub: { marginTop: 4, marginBottom: 16, color: isDark ? '#9aa4b2' : '#667', lineHeight: 20 },
  });
