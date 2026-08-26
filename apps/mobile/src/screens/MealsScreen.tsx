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
import ScreenHero from '../components/ui/ScreenHero';
import { FadeIn } from '../components/ui/FadeIn';
import { HC, themeColors } from '../theme';

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
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={HC.teal} />}
      >
        <ScreenHero
          eyebrow="FOOD LOG"
          title="Meals"
          subtitle="Tap a meal to view or edit category, macros, and time."
          pills={['Photo', 'Macros', 'AI']}
          compact
        />

        {loading && meals.length === 0 ? (
          <ActivityIndicator style={{ marginTop: 24 }} color={HC.teal} />
        ) : meals.length === 0 ? (
          <View style={t.emptyWrap}>
            <Text style={t.emptyIcon}>✦</Text>
            <Text style={t.empty}>No meals yet. Tap + to photograph a meal.</Text>
          </View>
        ) : (
          meals.map((m, i) => (
            <FadeIn key={m.id} delay={Math.min(i * 40, 240)}>
              <TouchableOpacity
                style={t.card}
                onPress={() =>
                  setSelected({
                    ...m,
                    resolvedPhotoUrl: photoUrls[m.id],
                  })
                }
                activeOpacity={0.85}
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
            </FadeIn>
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

const styles = (isDark: boolean) => {
  const c = themeColors(isDark);
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    content: { paddingBottom: 40 },
    emptyWrap: { alignItems: 'center', padding: 40, gap: 12 },
    emptyIcon: { fontSize: 32, color: HC.teal, opacity: 0.6 },
    empty: { color: c.muted, textAlign: 'center', fontSize: 14, lineHeight: 21 },
    card: {
      backgroundColor: c.card,
      borderRadius: HC.radius.lg,
      padding: 14,
      marginBottom: 10,
      marginHorizontal: 16,
      borderWidth: 1,
      borderColor: c.border,
    },
    cardRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
    thumb: { width: 64, height: 64, borderRadius: 14 },
    cardTitle: { fontWeight: '800', color: c.ink, textTransform: 'capitalize' },
    macros: { marginTop: 4, color: c.line, fontSize: 13 },
    summary: { marginTop: 6, color: c.muted, fontSize: 13, lineHeight: 18 },
    warn: { marginTop: 6, color: HC.amber, fontWeight: '700', fontSize: 12 },
  });
};
