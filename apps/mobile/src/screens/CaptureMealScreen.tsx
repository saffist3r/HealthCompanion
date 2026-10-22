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
import type {
  MealAnalysisResult,
  MealPhotoRole,
  MealType,
  GlycemiaReading,
} from '@health-companion/shared';
import {
  MEAL_PHOTO_ROLE_OPTIONS,
  mealPhotoRoleLabel,
  toMgDl,
} from '@health-companion/shared';
import { analyzeMealPhoto, saveMeal, uploadMealPhoto } from '../api/client';
import { useNavigation } from '@react-navigation/native';
import { onMealLogged } from '../pushNudges';
import { startPreBolusTimer } from '../preBolus';

const GLYCEMIA_KEY = '@health_companion/latest_glycemia';
const MAX_PHOTOS = 6;

type DraftPhoto = {
  id: string;
  uri: string;
  role: MealPhotoRole;
  photoPath?: string;
};

export default function CaptureMealScreen() {
  const isDark = useColorScheme() === 'dark';
  const nav = useNavigation();
  const [photos, setPhotos] = useState<DraftPhoto[]>([]);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [analysis, setAnalysis] = useState<MealAnalysisResult | null>(null);
  const [mealType, setMealType] = useState<MealType>('lunch');

  const t = styles(isDark);
  const analyzeUri = photos.find((p) => p.role === 'main')?.uri || photos[0]?.uri;

  const pick = async (fromCamera: boolean) => {
    if (photos.length >= MAX_PHOTOS) {
      Alert.alert('Limit reached', `You can add up to ${MAX_PHOTOS} photos per meal.`);
      return;
    }
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow camera / photos to log meals.');
      return;
    }
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: true })
      : await ImagePicker.launchImageLibraryAsync({
          quality: 0.7,
          allowsEditing: true,
          allowsMultipleSelection: true,
          selectionLimit: MAX_PHOTOS - photos.length,
        });
    if (result.canceled || !result.assets?.length) return;

    setPhotos((prev) => {
      const next = [...prev];
      for (const asset of result.assets) {
        if (!asset.uri || next.length >= MAX_PHOTOS) break;
        const role: MealPhotoRole =
          next.length === 0 ? 'main' : next.length === 1 ? 'dessert' : 'other';
        next.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          uri: asset.uri,
          role,
        });
      }
      return next;
    });
    setAnalysis(null);
  };

  const setRole = (id: string, role: MealPhotoRole) => {
    setPhotos((prev) => {
      let next = prev.map((p) => (p.id === id ? { ...p, role } : p));
      if (role === 'main') {
        next = next.map((p) => (p.id === id ? p : p.role === 'main' ? { ...p, role: 'other' } : p));
      }
      return next;
    });
  };

  const removePhoto = (id: string) => {
    setPhotos((prev) => {
      const next = prev.filter((p) => p.id !== id);
      if (next.length && !next.some((p) => p.role === 'main')) {
        next[0] = { ...next[0], role: 'main' };
      }
      return next;
    });
    setAnalysis(null);
  };

  const analyze = async () => {
    if (!analyzeUri) return;
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
      const res = await analyzeMealPhoto({ uri: analyzeUri, notes, glucoseMgDl });
      setAnalysis(res.analysis);
      setPhotos((prev) => {
        const idx = prev.findIndex((p) => p.uri === analyzeUri);
        if (idx < 0) return prev;
        return prev.map((p, i) =>
          i === idx
            ? { ...p, photoPath: res.photoPath, role: 'main' as const }
            : p.role === 'main'
              ? { ...p, role: 'other' as const }
              : p
        );
      });
      if (res.analysis.mealTypeGuess) setMealType(res.analysis.mealTypeGuess);
    } catch (e) {
      Alert.alert(
        'Analysis failed',
        String(e).includes('busy') || String(e).includes('503') || String(e).includes('UNAVAILABLE')
          ? 'AI is busy right now. Wait a few seconds and try again.'
          : String(e)
      );
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!analysis) return;
    setBusy(true);
    try {
      const uploaded: DraftPhoto[] = [];
      for (const p of photos) {
        if (p.photoPath) {
          uploaded.push(p);
          continue;
        }
        const up = await uploadMealPhoto(p.uri);
        uploaded.push({ ...p, photoPath: up.photoPath });
      }
      setPhotos(uploaded);

      const photoPayload = uploaded
        .filter((p) => p.photoPath)
        .map((p) => ({
          path: p.photoPath!,
          role: p.role,
        }));
      const primary =
        photoPayload.find((p) => p.role === 'main')?.path || photoPayload[0]?.path;

      await saveMeal({
        mealType,
        items: analysis.items,
        macros: analysis.macros,
        photoPath: primary,
        photos: photoPayload,
        notes: notes || undefined,
        aiSummary: analysis.summary,
        carbEstimateNote: analysis.carbEstimateNote,
        warnings: analysis.warnings,
        suggestions: analysis.suggestions,
        source: 'ai_photo',
      });
      const carbs =
        typeof analysis.macros?.carbsG === 'number' ? analysis.macros.carbsG : undefined;
      void onMealLogged(carbs);
      Alert.alert('Saved', 'Meal added to your food log.');
      nav.goBack();
    } catch (e) {
      Alert.alert('Save failed', String(e));
    } finally {
      setBusy(false);
    }
  };

  const preBolus = async () => {
    try {
      const mins = await startPreBolusTimer();
      Alert.alert(
        'Pre-bolus timer started',
        `Insulin gets a ${mins}-minute head start. We'll ping you when food may enter the chat.`
      );
    } catch (e) {
      Alert.alert('Timer failed', String(e));
    }
  };

  const types: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack', 'resucrage', 'other'];
  const typeLabel = (mt: MealType) =>
    mt === 'resucrage' ? 'Resucrage' : mt.charAt(0).toUpperCase() + mt.slice(1);

  return (
    <ScrollView style={t.root} contentContainerStyle={t.content}>
      <Text style={t.title}>Analyze meal</Text>
      <Text style={t.sub}>
        Add photos of the main dish, dessert, drinks… AI analyzes the main photo for carbs.
      </Text>

      <View style={t.row}>
        <TouchableOpacity style={t.btn} onPress={() => pick(true)}>
          <Text style={t.btnText}>Camera</Text>
        </TouchableOpacity>
        <TouchableOpacity style={t.btnSecondary} onPress={() => pick(false)}>
          <Text style={t.btnTextDark}>Gallery</Text>
        </TouchableOpacity>
      </View>

      {photos.length > 0 ? (
        <View style={t.photoList}>
          {photos.map((p) => (
            <View key={p.id} style={t.photoCard}>
              <Image source={{ uri: p.uri }} style={t.thumb} />
              <View style={t.photoMeta}>
                <Text style={t.photoRole}>{mealPhotoRoleLabel(p.role)}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={t.roleRow}>
                    {MEAL_PHOTO_ROLE_OPTIONS.map((opt) => (
                      <TouchableOpacity
                        key={opt.id}
                        style={[t.roleChip, p.role === opt.id && t.roleChipOn]}
                        onPress={() => setRole(p.id, opt.id)}
                      >
                        <Text style={[t.roleChipText, p.role === opt.id && t.roleChipTextOn]}>
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
                <TouchableOpacity onPress={() => removePhoto(p.id)}>
                  <Text style={t.remove}>Remove</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
          {photos.length < MAX_PHOTOS ? (
            <TouchableOpacity style={t.addMore} onPress={() => pick(false)}>
              <Text style={t.addMoreText}>+ Add another photo</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      <TextInput
        style={t.input}
        placeholder="Notes (e.g. half plate, sauce on side)"
        placeholderTextColor={isDark ? '#6e7681' : '#999'}
        value={notes}
        onChangeText={setNotes}
        multiline
      />

      <TouchableOpacity
        style={[t.primary, (!analyzeUri || busy) && { opacity: 0.5 }]}
        disabled={!analyzeUri || busy}
        onPress={analyze}
      >
        {busy && !analysis ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={t.primaryText}>Analyze main photo with AI</Text>
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
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={t.primaryText}>
                Save to food log
                {photos.length > 1 ? ` (${photos.length} photos)` : ''}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={t.preBolusBtn} onPress={preBolus} disabled={busy}>
            <Text style={t.preBolusText}>Start pre-bolus timer</Text>
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
    photoList: { gap: 10, marginBottom: 12 },
    photoCard: {
      flexDirection: 'row',
      gap: 10,
      backgroundColor: isDark ? '#161b22' : '#fff',
      borderRadius: 12,
      padding: 8,
      borderWidth: 1,
      borderColor: isDark ? '#30363d' : '#e5e7eb',
    },
    thumb: { width: 88, height: 88, borderRadius: 10 },
    photoMeta: { flex: 1, gap: 6, justifyContent: 'center' },
    photoRole: {
      fontWeight: '700',
      color: isDark ? '#e6edf3' : '#111',
      fontSize: 14,
    },
    roleRow: { flexDirection: 'row', gap: 6 },
    roleChip: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 12,
      backgroundColor: isDark ? '#21262d' : '#eef2f6',
    },
    roleChipOn: { backgroundColor: '#0d9488' },
    roleChipText: { fontSize: 12, color: isDark ? '#c9d1d9' : '#333' },
    roleChipTextOn: { color: '#fff', fontWeight: '700' },
    remove: { color: '#ef4444', fontSize: 13, fontWeight: '600' },
    addMore: {
      padding: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: isDark ? '#30363d' : '#cbd5e1',
      alignItems: 'center',
    },
    addMoreText: { color: isDark ? '#7ee787' : '#0f766e', fontWeight: '700' },
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
    preBolusBtn: {
      marginTop: 10,
      padding: 14,
      borderRadius: 12,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: isDark ? '#30363d' : '#cbd5e1',
      backgroundColor: isDark ? '#21262d' : '#f8fafc',
    },
    preBolusText: { fontWeight: '700', color: isDark ? '#7ee787' : '#0f766e', fontSize: 15 },
  });
