import { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  RefreshControl,
  Alert,
  useColorScheme,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { MealEntry } from '@health-companion/shared';
import { absoluteUploadUrl, listMeals } from '../api/client';
import { AppIcons } from '../ui/appIcons';
import MealDetailModal from '../components/MealDetailModal';

export default function MealsScreen() {
  const isDark = useColorScheme() === 'dark';
  const [meals, setMeals] = useState<MealEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<(MealEntry & { resolvedPhotoUrl?: string }) | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listMeals();
      setMeals(rows);
      const urls: Record<string, string> = {};
      for (const m of rows) {
        const u = await absoluteUploadUrl(m.photoUrl);
        if (u) urls[m.id] = u;
      }
      setPhotoUrls(urls);
    } catch (e) {
      Alert.alert('Could not load meals', String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const t = styles(isDark);

  return (
    <View style={t.root}>
      <ScrollView
        contentContainerStyle={t.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      >
        <Text style={t.title}>Food log</Text>
        <Text style={t.sub}>Tap a meal to view or edit category, macros, and time.</Text>

        {loading && meals.length === 0 ? (
          <ActivityIndicator style={{ marginTop: 24 }} />
        ) : meals.length === 0 ? (
          <Text style={t.empty}>No meals yet. Tap + to photograph a meal.</Text>
        ) : (
          meals.map((m) => (
            <TouchableOpacity
              key={m.id}
              style={t.card}
              onPress={() =>
                setSelected({
                  ...m,
                  resolvedPhotoUrl: photoUrls[m.id],
                })
              }
            >
              <View style={t.cardRow}>
                {photoUrls[m.id] ? (
                  <Image source={{ uri: photoUrls[m.id] }} style={t.thumb} />
                ) : (
                  <Image source={AppIcons.meals} style={t.thumb} />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={t.cardTitle}>
                    {m.mealType} · {new Date(m.eatenAt).toLocaleString()}
                  </Text>
                  <Text style={t.macros}>
                    {Math.round(m.macros.caloriesKcal || 0)} kcal · C {m.macros.carbsG}g · P{' '}
                    {m.macros.proteinG}g · F {m.macros.fatG}g
                  </Text>
                  {m.aiSummary ? (
                    <Text style={t.summary} numberOfLines={2}>
                      {m.aiSummary}
                    </Text>
                  ) : null}
                  {m.warnings?.length ? (
                    <Text style={t.warn}>
                      {m.warnings.length} warning{m.warnings.length > 1 ? 's' : ''}
                    </Text>
                  ) : null}
                </View>
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      <MealDetailModal
        meal={selected}
        onClose={() => setSelected(null)}
        onSaved={(updated) => {
          if ('deleted' in updated && updated.deleted) {
            setSelected(null);
            load();
            return;
          }
          load();
          setSelected({
            ...(updated as MealEntry),
            resolvedPhotoUrl: selected?.resolvedPhotoUrl,
          });
        }}
      />
    </View>
  );
}

const styles = (isDark: boolean) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: isDark ? '#0d1117' : '#f5f7fa' },
    content: { padding: 16, paddingBottom: 40 },
    title: { fontSize: 24, fontWeight: '700', color: isDark ? '#fff' : '#111' },
    sub: { marginTop: 4, marginBottom: 16, color: isDark ? '#9aa4b2' : '#667' },
    empty: { marginTop: 24, color: isDark ? '#9aa4b2' : '#667' },
    card: {
      backgroundColor: isDark ? '#161b22' : '#fff',
      borderRadius: 14,
      padding: 12,
      marginBottom: 10,
    },
    cardRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
    thumb: { width: 64, height: 64, borderRadius: 12 },
    cardTitle: { fontWeight: '700', color: isDark ? '#fff' : '#111', textTransform: 'capitalize' },
    macros: { marginTop: 4, color: isDark ? '#c9d1d9' : '#444', fontSize: 13 },
    summary: { marginTop: 6, color: isDark ? '#9aa4b2' : '#556', fontSize: 13 },
    warn: { marginTop: 6, color: '#d97706', fontWeight: '600', fontSize: 12 },
  });
