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
import { deleteMeal, updateMeal } from '../api/client';

const MEAL_TYPES = [
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'dinner', label: 'Dinner' },
  { value: 'snack', label: 'Snack' },
  { value: 'resucrage', label: 'Resucrage' },
  { value: 'other', label: 'Other' },
] as const;

type MealDetail = {
  id?: string;
  mealType?: string;
  eatenAt?: number;
  photoUrl?: string | null;
  resolvedPhotoUrl?: string | null;
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
  }, [meal]);

  if (!meal) return null;

  const macros = meal.macros || {};
  const photo = meal.resolvedPhotoUrl || meal.photoUrl;
  const items = meal.items || [];
  const ph = isDark ? '#6e7681' : '#9ca3af';

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
            {photo ? (
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
      backgroundColor: isDark ? '#161b22' : '#fff',
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingHorizontal: 16,
      paddingTop: 14,
    },
    head: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 12 },
    title: { fontSize: 22, fontWeight: '700', color: isDark ? '#fff' : '#111' },
    sub: { marginTop: 4, color: isDark ? '#8b949e' : '#667', fontSize: 13 },
    closeBtn: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 10,
      backgroundColor: isDark ? '#21262d' : '#e5e7eb',
    },
    closeText: { fontWeight: '600', color: isDark ? '#e6edf3' : '#111' },
    photo: {
      width: '100%',
      height: 220,
      borderRadius: 16,
      backgroundColor: '#0f172a',
      marginBottom: 12,
    },
    photoEmpty: {
      height: 100,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isDark ? '#21262d' : '#f1f5f9',
      marginBottom: 12,
    },
    pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
    pill: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      overflow: 'hidden',
      backgroundColor: isDark ? '#21262d' : '#eef2f7',
      color: isDark ? '#c9d1d9' : '#334155',
      fontWeight: '600',
      fontSize: 13,
    },
    pillCal: { backgroundColor: '#0d9488', color: '#fff' },
    section: { marginBottom: 14 },
    sectionTitle: {
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      color: isDark ? '#8b949e' : '#64748b',
      marginBottom: 6,
    },
    body: { fontSize: 16, lineHeight: 24, color: isDark ? '#e6edf3' : '#0f172a' },
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
      backgroundColor: isDark ? '#21262d' : '#e5e7eb',
    },
    chipOn: { backgroundColor: '#0d9488' },
    chipText: { fontWeight: '600', color: isDark ? '#c9d1d9' : '#333' },
    chipTextOn: { color: '#fff' },
    input: {
      borderWidth: 1,
      borderColor: isDark ? '#30363d' : '#d1d5db',
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginBottom: 8,
      color: isDark ? '#e6edf3' : '#111',
      backgroundColor: isDark ? '#0d1117' : '#fff',
    },
    btn: {
      marginTop: 8,
      backgroundColor: '#0d9488',
      borderRadius: 12,
      paddingVertical: 12,
      alignItems: 'center',
    },
    btnText: { color: '#fff', fontWeight: '700' },
    btnGhost: { backgroundColor: isDark ? '#21262d' : '#e5e7eb' },
    btnGhostText: { color: isDark ? '#e6edf3' : '#111', fontWeight: '700' },
    btnDanger: { backgroundColor: '#be123c', marginBottom: 20 },
  });
