import { useState } from 'react';
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
import { useEffect } from 'react';

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
      <Text style={t.brand}>Health Companion</Text>
      <Text style={t.sub}>Sign in to sync meals, glucose, and activity with your household dashboard.</Text>

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

      <TouchableOpacity style={t.btn} onPress={onSubmit} disabled={busy}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={t.btnText}>Sign in</Text>}
      </TouchableOpacity>

      <View style={t.card}>
        <Text style={t.hint}>
          Use the same account as the web dashboard. Ask the household admin if you need an invite.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = (isDark: boolean) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: isDark ? '#0d1117' : '#f5f7fa' },
    content: { padding: 24, paddingTop: 72, paddingBottom: 40 },
    brand: { fontSize: 28, fontWeight: '700', color: isDark ? '#fff' : '#111' },
    sub: { marginTop: 8, marginBottom: 28, color: isDark ? '#9aa4b2' : '#667', lineHeight: 20 },
    label: { fontSize: 13, color: isDark ? '#8b949e' : '#666', marginBottom: 6 },
    input: {
      borderWidth: 1,
      borderColor: isDark ? '#30363d' : '#ddd',
      borderRadius: 12,
      padding: 14,
      color: isDark ? '#e6edf3' : '#111',
      marginBottom: 14,
      backgroundColor: isDark ? '#161b22' : '#fff',
    },
    btn: {
      backgroundColor: '#0d9488',
      padding: 16,
      borderRadius: 12,
      alignItems: 'center',
      marginTop: 4,
    },
    btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
    card: {
      marginTop: 20,
      padding: 14,
      borderRadius: 12,
      backgroundColor: isDark ? '#161b22' : '#fff',
    },
    hint: { fontSize: 13, color: isDark ? '#8b949e' : '#666', lineHeight: 18 },
  });
