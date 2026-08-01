import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  TextInput,
  ScrollView,
  Alert,
  ActivityIndicator,
  useColorScheme,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MealAnalysisResult, MealType, GlycemiaReading } from '@health-companion/shared';
import { toMgDl } from '@health-companion/shared';
import { analyzeMealPhoto, saveMeal } from '../api/client';
import { useNavigation } from '@react-navigation/native';

const GLYCEMIA_KEY = '@health_companion/latest_glycemia';

export default function CaptureMealScreen() {
  const isDark = useColorScheme() === 'dark';
  const nav = useNavigation();
  const [uri, setUri] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [analysis, setAnalysis] = useState<MealAnalysisResult | null>(null);
  const [photoPath, setPhotoPath] = useState<string | undefined>();
  const [mealType, setMealType] = useState<MealType>('lunch');

  const t = styles(isDark);

  const pick = async (fromCamera: boolean) => {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow camera / photos to log meals.');
      return;
    }
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: true })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.7, allowsEditing: true });
    if (!result.canceled && result.assets[0]?.uri) {
      setUri(result.assets[0].uri);
      setAnalysis(null);
      setPhotoPath(undefined);
    }
  };

  const analyze = async () => {
    if (!uri) return;
    setBusy(true);
    try {
      let glucoseMgDl: number | null = null;
      try {
        const raw = await AsyncStorage.getItem(GLYCEMIA_KEY);
        if (raw) {
          const g = JSON.parse(raw) as GlycemiaReading;
          glucoseMgDl = toMgDl(g.value, g.unit);
        }
      } catch {
        /* ignore */
      }
      const res = await analyzeMealPhoto({ uri, notes, glucoseMgDl });
      setAnalysis(res.analysis);
      setPhotoPath(res.photoPath);
      if (res.analysis.mealTypeGuess) setMealType(res.analysis.mealTypeGuess);
    } catch (e) {
      Alert.alert('Analysis failed', String(e));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!analysis) return;
    setBusy(true);
    try {
      await saveMeal({
        mealType,
        items: analysis.items,
        macros: analysis.macros,
        photoPath,
        notes: notes || undefined,
        aiSummary: analysis.summary,
        carbEstimateNote: analysis.carbEstimateNote,
        warnings: analysis.warnings,
        suggestions: analysis.suggestions,
        source: 'ai_photo',
      });
      Alert.alert('Saved', 'Meal added to your food log.');
      nav.goBack();
    } catch (e) {
      Alert.alert('Save failed', String(e));
    } finally {
      setBusy(false);
    }
  };

  const types: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack', 'resucrage', 'other'];
  const typeLabel = (mt: MealType) =>
    mt === 'resucrage' ? 'Resucrage' : mt.charAt(0).toUpperCase() + mt.slice(1);

  return (
    <ScrollView style={t.root} contentContainerStyle={t.content}>
      <Text style={t.title}>Analyze meal</Text>
      <Text style={t.sub}>AI estimates carbs & macros — always verify with labels when possible.</Text>

      <View style={t.row}>
        <TouchableOpacity style={t.btn} onPress={() => pick(true)}>
          <Text style={t.btnText}>Camera</Text>
        </TouchableOpacity>
        <TouchableOpacity style={t.btnSecondary} onPress={() => pick(false)}>
          <Text style={t.btnTextDark}>Gallery</Text>
        </TouchableOpacity>
      </View>

      {uri ? <Image source={{ uri }} style={t.preview} /> : null}

      <TextInput
        style={t.input}
        placeholder="Notes (e.g. half plate, sauce on side)"
        placeholderTextColor={isDark ? '#6e7681' : '#999'}
        value={notes}
        onChangeText={setNotes}
        multiline
      />

      <TouchableOpacity
        style={[t.primary, (!uri || busy) && { opacity: 0.5 }]}
        disabled={!uri || busy}
        onPress={analyze}
      >
        {busy && !analysis ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={t.primaryText}>Analyze with AI</Text>
        )}
      </TouchableOpacity>

      {analysis ? (
        <View style={t.result}>
          <Text style={t.resultTitle}>Estimate</Text>
          <Text style={t.macros}>
            {Math.round(analysis.macros.caloriesKcal || 0)} kcal · Carbs {analysis.macros.carbsG}g ·
            Protein {analysis.macros.proteinG}g · Fat {analysis.macros.fatG}g
          </Text>
          <Text style={t.body}>{analysis.summary}</Text>
          <Text style={t.note}>{analysis.carbEstimateNote}</Text>

          <Text style={t.section}>Meal type</Text>
          <View style={t.chips}>
            {types.map((mt) => (
              <TouchableOpacity
                key={mt}
                style={[t.chip, mealType === mt && t.chipOn]}
                onPress={() => setMealType(mt)}
              >
                <Text style={[t.chipText, mealType === mt && t.chipTextOn]}>{typeLabel(mt)}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {analysis.items.map((item, i) => (
            <Text key={i} style={t.item}>
              • {item.name}
              {item.portion ? ` (${item.portion})` : ''} — {item.macros.carbsG}g carbs
              {item.macros.caloriesKcal
                ? ` · ${Math.round(item.macros.caloriesKcal)} kcal`
                : ''}
            </Text>
          ))}

          {analysis.suggestions?.length ? (
            <>
              <Text style={t.section}>Suggestions</Text>
              {analysis.suggestions.map((s, i) => (
                <Text key={i} style={t.item}>
                  • {s}
                </Text>
              ))}
            </>
          ) : null}

          {analysis.warnings?.length ? (
            <>
              <Text style={t.section}>Warnings</Text>
              {analysis.warnings.map((w, i) => (
                <View key={i} style={t.warnBox}>
                  <Text style={t.warnTitle}>
                    [{w.severity}] {w.title}
                  </Text>
                  <Text style={t.body}>{w.message}</Text>
                </View>
              ))}
            </>
          ) : null}

          <TouchableOpacity style={t.primary} onPress={save} disabled={busy}>
            <Text style={t.primaryText}>Save to food log</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = (isDark: boolean) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: isDark ? '#0d1117' : '#f5f7fa' },
    content: { padding: 16, paddingBottom: 48 },
    title: { fontSize: 24, fontWeight: '700', color: isDark ? '#fff' : '#111' },
    sub: { marginTop: 4, marginBottom: 16, color: isDark ? '#9aa4b2' : '#667' },
    row: { flexDirection: 'row', gap: 10, marginBottom: 12 },
    btn: {
      flex: 1,
      backgroundColor: '#0d9488',
      padding: 12,
      borderRadius: 10,
      alignItems: 'center',
    },
    btnSecondary: {
      flex: 1,
      backgroundColor: isDark ? '#21262d' : '#e5e7eb',
      padding: 12,
      borderRadius: 10,
      alignItems: 'center',
    },
    btnText: { color: '#fff', fontWeight: '700' },
    btnTextDark: { color: isDark ? '#e6edf3' : '#111', fontWeight: '700' },
    preview: { width: '100%', height: 220, borderRadius: 12, marginBottom: 12 },
    input: {
      borderWidth: 1,
      borderColor: isDark ? '#30363d' : '#ddd',
      borderRadius: 10,
      padding: 12,
      minHeight: 64,
      color: isDark ? '#e6edf3' : '#111',
      marginBottom: 12,
      textAlignVertical: 'top',
    },
    primary: {
      backgroundColor: '#0f766e',
      padding: 14,
      borderRadius: 12,
      alignItems: 'center',
      marginTop: 8,
    },
    primaryText: { color: '#fff', fontWeight: '700', fontSize: 16 },
    result: {
      marginTop: 20,
      backgroundColor: isDark ? '#161b22' : '#fff',
      borderRadius: 12,
      padding: 14,
    },
    resultTitle: { fontSize: 18, fontWeight: '700', color: isDark ? '#fff' : '#111' },
    macros: { marginTop: 6, fontWeight: '600', color: isDark ? '#7ee787' : '#0f766e' },
    body: { marginTop: 8, color: isDark ? '#c9d1d9' : '#444', lineHeight: 20 },
    note: { marginTop: 8, fontStyle: 'italic', color: isDark ? '#8b949e' : '#666', fontSize: 13 },
    section: {
      marginTop: 14,
      marginBottom: 6,
      fontWeight: '700',
      color: isDark ? '#e6edf3' : '#222',
    },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 16,
      backgroundColor: isDark ? '#21262d' : '#eef2f6',
    },
    chipOn: { backgroundColor: '#0d9488' },
    chipText: { color: isDark ? '#c9d1d9' : '#333', textTransform: 'capitalize', fontSize: 13 },
    chipTextOn: { color: '#fff', fontWeight: '700' },
    item: { color: isDark ? '#c9d1d9' : '#444', marginTop: 4 },
    warnBox: {
      marginTop: 8,
      padding: 10,
      borderRadius: 8,
      backgroundColor: isDark ? '#3d2c00' : '#fff7ed',
    },
    warnTitle: { fontWeight: '700', color: '#d97706', marginBottom: 4 },
  });
