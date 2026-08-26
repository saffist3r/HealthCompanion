import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useColorScheme,
  View,
} from 'react-native';
import { DEFAULT_API_BASE_URL, getApiBaseUrl, setApiBaseUrl } from '../api/config';
import { useAuth } from '../auth/AuthContext';
import ScreenHero from '../components/ui/ScreenHero';
import { FadeIn } from '../components/ui/FadeIn';
import { HC, themeColors } from '../theme';

export default function LoginScreen() {
  const isDark = useColorScheme() === 'dark';
  const { signIn } = useAuth();
  const [url, setUrl] = useState(DEFAULT_API_BASE_URL);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const t = styles(isDark);

  useEffect(() => {
    getApiBaseUrl().then(setUrl);
  }, []);

  const onSubmit = async () => {
    setBusy(true);
    try {
      await setApiBaseUrl(url.trim());
      await signIn(email.trim(), password);
    } catch (e) {
      Alert.alert('Sign in failed', String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={t.root} contentContainerStyle={t.content} keyboardShouldPersistTaps="handled">
      <ScreenHero
        eyebrow="HEALTH COMPANION"
        title="Welcome back"
        subtitle="Sign in to sync meals, glucose, and activity with your household dashboard."
        pills={['Sync', 'Household', 'Secure']}
      />

      <FadeIn>
        <View style={t.form}>
          <Text style={t.label}>API URL</Text>
          <TextInput
            style={t.input}
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            placeholderTextColor={isDark ? '#6e7681' : '#999'}
          />

          <Text style={t.label}>Email</Text>
          <TextInput
            style={t.input}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            placeholderTextColor={isDark ? '#6e7681' : '#999'}
          />

          <Text style={t.label}>Password</Text>
          <TextInput
            style={t.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
            placeholderTextColor={isDark ? '#6e7681' : '#999'}
          />

          <TouchableOpacity style={t.btn} onPress={onSubmit} disabled={busy} activeOpacity={0.85}>
            {busy ? (
              <ActivityIndicator color={HC.tealDeep} />
            ) : (
              <Text style={t.btnText}>Sign in</Text>
            )}
          </TouchableOpacity>

          <View style={t.card}>
            <Text style={t.hint}>
              Use the same account as the web dashboard. Ask the household admin if you need an invite.
            </Text>
          </View>
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
    form: { paddingHorizontal: 24, marginTop: 8 },
    label: { fontSize: 12, color: c.muted, marginBottom: 6, fontWeight: '800', textTransform: 'uppercase' },
    input: {
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: HC.radius.md,
      padding: 14,
      marginBottom: 16,
      color: c.ink,
      backgroundColor: c.card,
      fontSize: 16,
    },
    btn: {
      backgroundColor: '#fff',
      borderRadius: HC.radius.md,
      paddingVertical: 16,
      alignItems: 'center',
      marginTop: 4,
      borderWidth: 1,
      borderColor: c.border,
      shadowColor: '#000',
      shadowOpacity: 0.08,
      shadowRadius: 8,
      elevation: 2,
    },
    btnText: { color: HC.tealDeep, fontWeight: '800', fontSize: 16 },
    card: {
      marginTop: 20,
      padding: 16,
      borderRadius: HC.radius.lg,
      backgroundColor: c.card,
      borderWidth: 1,
      borderColor: c.border,
    },
    hint: { color: c.muted, lineHeight: 20, fontSize: 13 },
  });
};
