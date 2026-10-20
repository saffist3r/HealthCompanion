import { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  useColorScheme,
  ScrollView,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { apiHealth, fetchBodyProfile, markDeviceCare, type DeviceCarePayload } from '../api/client';
import { DEFAULT_API_BASE_URL, getApiBaseUrl, setApiBaseUrl } from '../api/config';
import { getDeviceId } from '../api/deviceId';
import { useAuth } from '../auth/AuthContext';
import {
  getPreBolusMinutes,
  setPreBolusMinutes,
  PRE_BOLUS_OPTIONS_MIN,
  type PreBolusMinutes,
} from '../preBolus';

export default function SettingsScreen() {
  const isDark = useColorScheme() === 'dark';
  const { user, signOut, refresh } = useAuth();
  const [url, setUrl] = useState(DEFAULT_API_BASE_URL);
  const [deviceId, setDeviceId] = useState('');
  const [status, setStatus] = useState<string>('—');
  const [deviceCare, setDeviceCare] = useState<DeviceCarePayload | null>(null);
  const [careBusy, setCareBusy] = useState(false);
  const [preBolusMin, setPreBolusMin] = useState<PreBolusMinutes>(15);
  const t = styles(isDark);

  const loadDeviceCare = useCallback(async () => {
    try {
      const body = await fetchBodyProfile();
      setDeviceCare({
        cannulaChangedAt: body.profile.cannulaChangedAt,
        sensorStartedAt: body.profile.sensorStartedAt,
        cannulaDay: body.profile.cannulaDay,
        sensorDay: body.profile.sensorDay,
        siteChangeSuggested: body.profile.siteChangeSuggested,
        sensorAging: body.profile.sensorAging,
      });
    } catch {
      /* optional section */
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      getApiBaseUrl().then(setUrl);
      getDeviceId().then(setDeviceId);
      getPreBolusMinutes().then(setPreBolusMin);
      loadDeviceCare();
      refresh();
    }, [refresh, loadDeviceCare])
  );

  const save = async () => {
    await setApiBaseUrl(url.trim());
    Alert.alert('Saved', 'API base URL updated.');
  };

  const ping = async () => {
    try {
      await setApiBaseUrl(url.trim());
      const h = await apiHealth();
      setStatus(
        h.ok
          ? `OK · auth ${h.auth || 'jwt'} · Gemini ${
              h.geminiConfigured ? 'configured' : 'missing key'
            }`
          : 'Unreachable'
      );
    } catch (e) {
      setStatus(String(e));
    }
  };

  const markCannula = async () => {
    setCareBusy(true);
    try {
      await markDeviceCare({ markCannulaChanged: true });
      await loadDeviceCare();
      Alert.alert('Marked', 'Cannula site change logged. Fresh real estate unlocked.');
    } catch (e) {
      Alert.alert('Update failed', String(e));
    } finally {
      setCareBusy(false);
    }
  };

  const markSensor = async () => {
    setCareBusy(true);
    try {
      await markDeviceCare({ markSensorStarted: true });
      await loadDeviceCare();
      Alert.alert('Marked', 'New sensor arc started. Day zero energy.');
    } catch (e) {
      Alert.alert('Update failed', String(e));
    } finally {
      setCareBusy(false);
    }
  };

  const pickPreBolus = async (min: PreBolusMinutes) => {
    await setPreBolusMinutes(min);
    setPreBolusMin(min);
  };

  return (
    <ScrollView style={t.root} contentContainerStyle={t.content}>
      <Text style={t.title}>Connection</Text>
      <Text style={t.sub}>API endpoint and signed-in household account.</Text>

      <Text style={t.label}>API base URL</Text>
      <TextInput
        style={t.input}
        value={url}
        onChangeText={setUrl}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={DEFAULT_API_BASE_URL}
        placeholderTextColor={isDark ? '#6e7681' : '#999'}
      />
      <TouchableOpacity style={t.btn} onPress={save}>
        <Text style={t.btnText}>Save URL</Text>
      </TouchableOpacity>
      <TouchableOpacity style={t.btnSecondary} onPress={ping}>
        <Text style={t.btnTextDark}>Test connection</Text>
      </TouchableOpacity>

      <View style={t.card}>
        <Text style={t.label}>API status</Text>
        <Text style={t.value}>{status}</Text>
        <Text style={[t.label, { marginTop: 12 }]}>Device ID</Text>
        <Text style={t.value} selectable>
          {deviceId}
        </Text>
      </View>

      <Text style={t.section}>Account</Text>
      <View style={t.card}>
        <Text style={t.value}>
          {user?.displayName || user?.email} · {user?.role}
        </Text>
        <Text style={t.hint}>{user?.email}</Text>
        <TouchableOpacity
          style={[t.btnSecondary, { marginTop: 12, marginBottom: 0 }]}
          onPress={async () => {
            await signOut();
          }}
        >
          <Text style={t.btnTextDark}>Sign out</Text>
        </TouchableOpacity>
      </View>

      <Text style={t.section}>Device care</Text>
      <View style={t.card}>
        <Text style={t.value}>
          Cannula: day {deviceCare?.cannulaDay ?? '—'}
          {deviceCare?.siteChangeSuggested ? ' · site change suggested' : ''}
        </Text>
        <Text style={[t.value, { marginTop: 8 }]}>
          Sensor: day {deviceCare?.sensorDay ?? '—'}
          {deviceCare?.sensorAging ? ' · aging sensor vibes' : ''}
        </Text>
        <View style={t.careRow}>
          <TouchableOpacity
            style={[t.btnSecondary, t.careBtn]}
            onPress={markCannula}
            disabled={careBusy}
          >
            <Text style={t.btnTextDark}>Mark cannula changed</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[t.btnSecondary, t.careBtn]}
            onPress={markSensor}
            disabled={careBusy}
          >
            <Text style={t.btnTextDark}>Mark sensor started</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Text style={t.section}>Pre-bolus timer</Text>
      <View style={t.card}>
        <Text style={t.hint}>Default minutes before the &quot;eat now&quot; ping on meal capture.</Text>
        <View style={t.chipRow}>
          {PRE_BOLUS_OPTIONS_MIN.map((min) => (
            <TouchableOpacity
              key={min}
              style={[t.chip, preBolusMin === min && t.chipOn]}
              onPress={() => pickPreBolus(min)}
            >
              <Text style={[t.chipText, preBolusMin === min && t.chipTextOn]}>{min} min</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <Text style={t.disclaimer}>
        Meal estimates and suggestions are not medical advice. Confirm carbs with packaging when
        possible and follow your care team’s insulin guidance.
      </Text>
    </ScrollView>
  );
}

const styles = (isDark: boolean) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: isDark ? '#0d1117' : '#f5f7fa' },
    content: { padding: 16, paddingBottom: 40 },
    title: { fontSize: 24, fontWeight: '700', color: isDark ? '#fff' : '#111' },
    section: {
      marginTop: 8,
      marginBottom: 10,
      fontSize: 18,
      fontWeight: '700',
      color: isDark ? '#fff' : '#111',
    },
    sub: { marginTop: 4, marginBottom: 16, color: isDark ? '#9aa4b2' : '#667' },
    label: { fontSize: 13, color: isDark ? '#8b949e' : '#666', marginBottom: 6 },
    input: {
      borderWidth: 1,
      borderColor: isDark ? '#30363d' : '#ddd',
      borderRadius: 10,
      padding: 12,
      color: isDark ? '#e6edf3' : '#111',
      marginBottom: 8,
    },
    hint: { fontSize: 12, color: isDark ? '#6e7681' : '#888', marginTop: 4, lineHeight: 18 },
    btn: {
      backgroundColor: '#0d9488',
      padding: 14,
      borderRadius: 12,
      alignItems: 'center',
      marginBottom: 10,
    },
    btnSecondary: {
      backgroundColor: isDark ? '#21262d' : '#e5e7eb',
      padding: 14,
      borderRadius: 12,
      alignItems: 'center',
      marginBottom: 10,
    },
    btnText: { color: '#fff', fontWeight: '700' },
    btnTextDark: { color: isDark ? '#e6edf3' : '#111', fontWeight: '700' },
    card: {
      backgroundColor: isDark ? '#161b22' : '#fff',
      borderRadius: 12,
      padding: 14,
      marginBottom: 16,
      marginTop: 6,
    },
    value: { color: isDark ? '#e6edf3' : '#222', marginTop: 4 },
    disclaimer: { fontSize: 12, color: isDark ? '#6e7681' : '#888', lineHeight: 18 },
    careRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
    careBtn: { flex: 1, marginBottom: 0 },
    chipRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
    chip: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: isDark ? '#21262d' : '#e5e7eb',
    },
    chipOn: { backgroundColor: '#0d9488' },
    chipText: { fontWeight: '600', color: isDark ? '#c9d1d9' : '#333' },
    chipTextOn: { color: '#fff' },
  });
