import { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  useColorScheme,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { deleteMeal, fetchMeal, updateMeal, absoluteUploadUrl, type SimilarMeal, type MealGlucoseStory } from '../api/client';
import { mealPhotoRoleLabel } from '@health-companion/shared';

const MEAL_TYPES = [
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'dinner', label: 'Dinner' },
  { value: 'snack', label: 'Snack' },
  { value: 'resucrage', label: 'Resucrage' },
  { value: 'other', label: 'Other' },
] as const;

type MealPhotoView = {
  url: string;
  role?: string;
  label?: string;
};

type MealDetail = {
  id?: string;
  mealType?: string;
  eatenAt?: number;
  photoUrl?: string | null;
  resolvedPhotoUrl?: string | null;
  photos?: MealPhotoView[];
  resolvedPhotos?: MealPhotoView[];
  macros?: {
    caloriesKcal?: number;
    carbsG?: number;
    proteinG?: number;
    fatG?: number;
    fiberG?: number;
    sugarG?: number;
  };
  items?: Array<{ name?: string; portion?: string; estimatedCarbsG?: number } | string>;
  notes?: string | null;
  aiSummary?: string | null;
  carbEstimateNote?: string | null;
  warnings?: Array<{ title?: string; message?: string; severity?: string }>;
  suggestions?: string[];
  source?: string;
  wouldAgain?: number | null;
  wouldAgainNote?: string | null;
  relatedHypoStartedAt?: number | null;
  glucoseStory?: MealGlucoseStory | null;
  similarMeals?: SimilarMeal[];
};

function mealTypeLabel(type?: string) {
  if (!type) return 'Meal';
  if (type === 'resucrage') return 'Resucrage';
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function itemLabel(item: { name?: string; portion?: string; estimatedCarbsG?: number } | string) {
  if (typeof item === 'string') return item;
  const bits = [item.name, item.portion].filter(Boolean);
  if (item.estimatedCarbsG != null) bits.push(`~${item.estimatedCarbsG}g carbs`);
  return bits.join(' · ') || 'Item';
}

function toDateInput(ts?: number) {
  if (!ts) return '';
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toTimeInput(ts?: number) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function wouldAgainLabel(v: number | null | undefined) {
  if (v === 1) return 'Yes';
  if (v === -1) return 'Nope';
  if (v === 0) return 'Meh';
  return '—';
}

function formatHypoTime(ts?: number | null) {
  if (!ts) return '';
  return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function MealDetailModal({
  meal,
  onClose,
  onSaved,
}: {
  meal: MealDetail | null;
  onClose: () => void;
  onSaved?: (meal: MealDetail | { id: string; deleted: true }) => void;
}) {
  const isDark = useColorScheme() === 'dark';
  const insets = useSafeAreaInsets();
  const t = styles(isDark);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mealType, setMealType] = useState('other');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [carbs, setCarbs] = useState('');
  const [protein, setProtein] = useState('');
  const [fat, setFat] = useState('');
  const [calories, setCalories] = useState('');
  const [notes, setNotes] = useState('');
  const [summary, setSummary] = useState('');
  const [wouldAgain, setWouldAgain] = useState<number | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [glucoseStory, setGlucoseStory] = useState<MealGlucoseStory | null>(null);
  const [similarMeals, setSimilarMeals] = useState<SimilarMeal[]>([]);
  const [relatedHypoStartedAt, setRelatedHypoStartedAt] = useState<number | null>(null);
  const [gallery, setGallery] = useState<MealPhotoView[]>([]);

  useEffect(() => {
    if (!meal) return;
    setEditing(false);
    setMealType(meal.mealType || 'other');
    setDate(toDateInput(meal.eatenAt));
    setTime(toTimeInput(meal.eatenAt));
    setCarbs(String(meal.macros?.carbsG ?? 0));
    setProtein(String(meal.macros?.proteinG ?? 0));
    setFat(String(meal.macros?.fatG ?? 0));
    setCalories(String(Math.round(meal.macros?.caloriesKcal || 0)));
    setNotes(meal.notes || '');
    setSummary(meal.aiSummary || '');
    setWouldAgain(meal.wouldAgain ?? null);
    setGlucoseStory(meal.glucoseStory ?? null);
    setSimilarMeals(meal.similarMeals ?? []);
    setRelatedHypoStartedAt(meal.relatedHypoStartedAt ?? null);
    setGallery(meal.resolvedPhotos || meal.photos || []);

    if (meal.id) {
      setDetailLoading(true);
      fetchMeal(meal.id)
        .then(async (full) => {
          setWouldAgain(full.wouldAgain ?? null);
          setGlucoseStory(full.glucoseStory ?? null);
          setSimilarMeals(full.similarMeals ?? []);
          setRelatedHypoStartedAt(full.relatedHypoStartedAt ?? null);
          const rawPhotos =
            (full.photos && full.photos.length > 0
              ? full.photos
              : full.photoUrl
                ? [{ url: full.photoUrl, role: 'main' }]
                : []) as MealPhotoView[];
          const resolved: MealPhotoView[] = [];
          for (const p of rawPhotos) {
            const abs = await absoluteUploadUrl(p.url);
            if (abs) resolved.push({ ...p, url: abs });
          }
          if (resolved.length) setGallery(resolved);
        })
        .catch(() => {
          /* keep list payload */
        })
        .finally(() => setDetailLoading(false));
    }
  }, [meal]);

  if (!meal) return null;

  const macros = meal.macros || {};
  const photo = gallery[0]?.url || meal.resolvedPhotoUrl || meal.photoUrl;
  const items = meal.items || [];
  const ph = isDark ? '#6e7681' : '#9ca3af';

  const rateWouldAgain = async (value: number) => {
    if (!meal.id) return;
    setWouldAgain(value);
    try {
      await updateMeal(meal.id, { wouldAgain: value });
    } catch (e) {
      Alert.alert('Rating failed', String(e));
    }
  };

  const save = async () => {
    if (!meal.id) return;
    setBusy(true);
    try {
      const c = Number(carbs) || 0;
      const p = Number(protein) || 0;
      const f = Number(fat) || 0;
      const cal = Number(calories);
      const estimated = Math.round(c * 4 + p * 4 + f * 9);
      const eatenAt =
        date && time
          ? new Date(`${date}T${time}:00`).toISOString()
          : date
            ? new Date(`${date}T12:00:00`).toISOString()
            : undefined;
      const updated = await updateMeal(meal.id, {
        mealType,
        notes: notes.trim() || null,
        aiSummary: summary.trim() || null,
        eatenAt,
        macros: {
          carbsG: c,
          proteinG: p,
          fatG: f,
          fiberG: macros.fiberG ?? 0,
          sugarG: macros.sugarG ?? 0,
          caloriesKcal: Number.isFinite(cal) && cal > 0 ? Math.round(cal) : estimated,
        },
      });
      onSaved?.({
        ...updated,
        resolvedPhotoUrl: meal.resolvedPhotoUrl,
      });
      setEditing(false);
    } catch (e) {
      Alert.alert('Update failed', String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    if (!meal.id) return;
    Alert.alert('Delete meal?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await deleteMeal(meal.id!);
            onSaved?.({ id: meal.id!, deleted: true });
            onClose();
          } catch (e) {
            Alert.alert('Delete failed', String(e));
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={t.root}>
        <Pressable style={t.backdrop} onPress={onClose} />
        <View style={[t.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={t.head}>
            <View style={{ flex: 1 }}>
              <Text style={t.title}>{editing ? 'Edit meal' : mealTypeLabel(meal.mealType)}</Text>
              <Text style={t.sub}>
                {meal.eatenAt ? new Date(meal.eatenAt).toLocaleString() : '—'}
                {meal.source ? ` · ${meal.source}` : ''}
              </Text>
            </View>
            {!editing ? (
              <TouchableOpacity onPress={() => setEditing(true)} style={t.closeBtn}>
                <Text style={t.closeText}>Edit</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity onPress={onClose} style={t.closeBtn}>
              <Text style={t.closeText}>Close</Text>
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {gallery.length > 1 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ marginBottom: 12 }}
                contentContainerStyle={{ gap: 10, paddingRight: 8 }}
              >
                {gallery.map((p, i) => (
                  <View key={`${p.url}-${i}`} style={t.galleryCard}>
                    <Image source={{ uri: p.url }} style={t.galleryPhoto} resizeMode="cover" />
                    <Text style={t.galleryLabel}>
                      {p.label || mealPhotoRoleLabel(p.role)}
                    </Text>
                  </View>
                ))}
              </ScrollView>
            ) : photo ? (
              <Image source={{ uri: photo }} style={t.photo} resizeMode="contain" />
            ) : (
              <View style={t.photoEmpty}>
                <Text style={t.sub}>No photo for this meal</Text>
              </View>
            )}

            {editing ? (
              <View>
                <Text style={t.sectionTitle}>Category</Text>
                <View style={t.chipRow}>
                  {MEAL_TYPES.map((opt) => (
                    <TouchableOpacity
                      key={opt.value}
                      style={[t.chip, mealType === opt.value && t.chipOn]}
                      onPress={() => setMealType(opt.value)}
                    >
                      <Text style={[t.chipText, mealType === opt.value && t.chipTextOn]}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TextInput
                  style={t.input}
                  placeholder="Date (YYYY-MM-DD)"
                  placeholderTextColor={ph}
                  value={date}
                  onChangeText={setDate}
                  autoCapitalize="none"
                />
                <TextInput
                  style={t.input}
                  placeholder="Time (HH:MM)"
                  placeholderTextColor={ph}
                  value={time}
                  onChangeText={setTime}
                  autoCapitalize="none"
                />
                <TextInput
                  style={t.input}
                  placeholder="Carbs (g)"
                  placeholderTextColor={ph}
                  value={carbs}
                  onChangeText={setCarbs}
                  keyboardType="decimal-pad"
                />
                <TextInput
                  style={t.input}
                  placeholder="Protein (g)"
                  placeholderTextColor={ph}
                  value={protein}
                  onChangeText={setProtein}
                  keyboardType="decimal-pad"
                />
                <TextInput
                  style={t.input}
                  placeholder="Fat (g)"
                  placeholderTextColor={ph}
                  value={fat}
                  onChangeText={setFat}
                  keyboardType="decimal-pad"
                />
                <TextInput
                  style={t.input}
                  placeholder="Calories (kcal)"
                  placeholderTextColor={ph}
                  value={calories}
                  onChangeText={setCalories}
                  keyboardType="number-pad"
                />
                <TextInput
                  style={t.input}
                  placeholder="Summary"
                  placeholderTextColor={ph}
                  value={summary}
                  onChangeText={setSummary}
                />
                <TextInput
                  style={t.input}
                  placeholder="Notes"
                  placeholderTextColor={ph}
                  value={notes}
                  onChangeText={setNotes}
                />
                <TouchableOpacity style={t.btn} onPress={save} disabled={busy}>
                  {busy ? <ActivityIndicator color="#fff" /> : <Text style={t.btnText}>Save changes</Text>}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[t.btn, t.btnGhost]}
                  onPress={() => setEditing(false)}
                  disabled={busy}
                >
                  <Text style={t.btnGhostText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[t.btn, t.btnDanger]} onPress={remove} disabled={busy}>
                  <Text style={t.btnText}>Delete meal</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <View style={t.pills}>
                  <Text style={[t.pill, t.pillCal]}>{Math.round(macros.caloriesKcal || 0)} kcal</Text>
                  <Text style={t.pill}>C {macros.carbsG ?? 0}g</Text>
                  <Text style={t.pill}>P {macros.proteinG ?? 0}g</Text>
                  <Text style={t.pill}>F {macros.fatG ?? 0}g</Text>
                </View>

                {meal.aiSummary ? (
                  <View style={t.section}>
                    <Text style={t.sectionTitle}>Summary</Text>
                    <Text style={t.body}>{meal.aiSummary}</Text>
                  </View>
                ) : null}

                {meal.notes ? (
                  <View style={t.section}>
                    <Text style={t.sectionTitle}>Notes</Text>
                    <Text style={t.body}>{meal.notes}</Text>
                  </View>
                ) : null}

                {meal.carbEstimateNote ? (
                  <View style={t.section}>
                    <Text style={t.sectionTitle}>Carb estimate</Text>
                    <Text style={[t.body, t.sub]}>{meal.carbEstimateNote}</Text>
                  </View>
                ) : null}

                {items.length > 0 ? (
                  <View style={t.section}>
                    <Text style={t.sectionTitle}>Items</Text>
                    {items.map((it, i) => (
                      <Text key={i} style={t.item}>
                        • {itemLabel(it)}
                      </Text>
                    ))}
                  </View>
                ) : null}

                {(meal.suggestions || []).map((s, i) => (
                  <Text key={`s-${i}`} style={t.item}>
                    • {s}
                  </Text>
                ))}

                {(meal.warnings || []).map((w, i) => (
                  <View key={`w-${i}`} style={t.warn}>
                    <Text style={t.warnTitle}>{w.title || 'Warning'}</Text>
                    <Text style={t.body}>{w.message}</Text>
                  </View>
                ))}

                {detailLoading ? (
                  <ActivityIndicator style={{ marginVertical: 12 }} color="#0891B2" />
                ) : null}

                {glucoseStory?.blurb ? (
                  <View style={t.section}>
                    <Text style={t.sectionTitle}>Glucose story</Text>
                    <Text style={t.body}>{glucoseStory.blurb}</Text>
                    {!glucoseStory.ready && glucoseStory.reason === 'waiting_for_glucose' ? (
                      <Text style={t.sub}>Still collecting CGM data for this meal window.</Text>
                    ) : null}
                  </View>
                ) : null}

                {relatedHypoStartedAt ? (
                  <View style={t.hypoNote}>
                    <Text style={t.hypoNoteTitle}>Possible resucrage context</Text>
                    <Text style={t.body}>
                      Hypo episode around {formatHypoTime(relatedHypoStartedAt)} — this meal may have
                      been the sequel.
                    </Text>
                  </View>
                ) : null}

                {!editing ? (
                  <View style={t.section}>
                    <Text style={t.sectionTitle}>Would eat again?</Text>
                    <View style={t.rateRow}>
                      {([
                        { v: -1, label: 'Nope' },
                        { v: 0, label: 'Meh' },
                        { v: 1, label: 'Yes' },
                      ] as const).map(({ v, label }) => (
                        <TouchableOpacity
                          key={v}
                          style={[t.rateBtn, wouldAgain === v && t.rateBtnOn]}
                          onPress={() => rateWouldAgain(v)}
                        >
                          <Text style={[t.rateBtnText, wouldAgain === v && t.rateBtnTextOn]}>
                            {label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    {wouldAgain != null ? (
                      <Text style={t.sub}>Rated: {wouldAgainLabel(wouldAgain)}</Text>
                    ) : null}
                  </View>
                ) : null}

                {similarMeals.length > 0 ? (
                  <View style={t.section}>
                    <Text style={t.sectionTitle}>Similar meals</Text>
                    {similarMeals.map((sm) => (
                      <View key={sm.id} style={t.similarRow}>
                        <Text style={t.item}>
                          {mealTypeLabel(sm.mealType)} · {sm.carbsG ?? '?'}g carbs
                          {sm.wouldAgain === 1 ? ' · liked' : sm.wouldAgain === -1 ? ' · skip' : ''}
                        </Text>
                        {sm.aiSummary ? (
                          <Text style={t.sub} numberOfLines={2}>
                            {sm.aiSummary}
                          </Text>
                        ) : null}
                        {sm.glucoseStory?.blurb ? (
                          <Text style={[t.sub, { fontStyle: 'italic' }]}>{sm.glucoseStory.blurb}</Text>
                        ) : null}
                      </View>
                    ))}
                  </View>
                ) : null}
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = (isDark: boolean) =>
  StyleSheet.create({
    root: { flex: 1, justifyContent: 'flex-end' },
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.5)' },
    sheet: {
      maxHeight: '92%',
      backgroundColor: isDark ? '#0E1624' : '#fff',
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingHorizontal: 16,
      paddingTop: 14,
    },
    head: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 12 },
    title: { fontSize: 22, fontWeight: '700', color: isDark ? '#fff' : '#111' },
    sub: { marginTop: 4, color: isDark ? '#8CA0BC' : '#667', fontSize: 13 },
    closeBtn: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 10,
      backgroundColor: isDark ? '#16233A' : '#e5e7eb',
    },
    closeText: { fontWeight: '600', color: isDark ? '#E6F4FF' : '#111' },
    photo: {
      width: '100%',
      height: 220,
      borderRadius: 16,
      backgroundColor: '#0f172a',
      marginBottom: 12,
    },
    galleryCard: { width: 200 },
    galleryPhoto: {
      width: 200,
      height: 200,
      borderRadius: 14,
      backgroundColor: '#0f172a',
    },
    galleryLabel: {
      marginTop: 6,
      fontSize: 13,
      fontWeight: '600',
      color: isDark ? '#c9d1d9' : '#334155',
    },
    photoEmpty: {
      height: 100,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isDark ? '#16233A' : '#f1f5f9',
      marginBottom: 12,
    },
    pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
    pill: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      overflow: 'hidden',
      backgroundColor: isDark ? '#16233A' : '#eef2f7',
      color: isDark ? '#c9d1d9' : '#334155',
      fontWeight: '600',
      fontSize: 13,
    },
    pillCal: { backgroundColor: '#0891B2', color: '#fff' },
    section: { marginBottom: 14 },
    sectionTitle: {
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      color: isDark ? '#8CA0BC' : '#64748b',
      marginBottom: 6,
    },
    body: { fontSize: 16, lineHeight: 24, color: isDark ? '#E6F4FF' : '#0f172a' },
    item: { fontSize: 15, lineHeight: 22, color: isDark ? '#c9d1d9' : '#334155', marginTop: 4 },
    warn: {
      marginBottom: 10,
      padding: 12,
      borderRadius: 12,
      backgroundColor: isDark ? '#3d2c00' : '#fff7ed',
    },
    warnTitle: { fontWeight: '700', color: '#d97706', marginBottom: 4 },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
    chip: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: isDark ? '#16233A' : '#e5e7eb',
    },
    chipOn: { backgroundColor: '#0891B2' },
    chipText: { fontWeight: '600', color: isDark ? '#c9d1d9' : '#333' },
    chipTextOn: { color: '#fff' },
    input: {
      borderWidth: 1,
      borderColor: isDark ? '#1E3350' : '#d1d5db',
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginBottom: 8,
      color: isDark ? '#E6F4FF' : '#111',
      backgroundColor: isDark ? '#070B14' : '#fff',
    },
    btn: {
      marginTop: 8,
      backgroundColor: '#0891B2',
      borderRadius: 12,
      paddingVertical: 12,
      alignItems: 'center',
    },
    btnText: { color: '#fff', fontWeight: '700' },
    btnGhost: { backgroundColor: isDark ? '#16233A' : '#e5e7eb' },
    btnGhostText: { color: isDark ? '#E6F4FF' : '#111', fontWeight: '700' },
    btnDanger: { backgroundColor: '#be123c', marginBottom: 20 },
    rateRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
    rateBtn: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 10,
      alignItems: 'center',
      backgroundColor: isDark ? '#16233A' : '#eef2f7',
    },
    rateBtnOn: { backgroundColor: '#0891B2' },
    rateBtnText: { fontWeight: '700', color: isDark ? '#c9d1d9' : '#334155' },
    rateBtnTextOn: { color: '#fff' },
    hypoNote: {
      marginBottom: 14,
      padding: 12,
      borderRadius: 12,
      backgroundColor: isDark ? '#1c2a3a' : '#eff6ff',
    },
    hypoNoteTitle: { fontWeight: '700', color: '#2563eb', marginBottom: 4 },
    similarRow: { marginBottom: 10, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: isDark ? '#1E3350' : '#e5e7eb' },
  });
