import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import MealDetailModal from '../components/MealDetailModal';
import { groupByDay, loadTimeline, LOG_FILTERS, timeLabel, type LogKind, type TimelineItem } from '../log/timeline';
import { Chip, EmptyNote, HUD, Label, Panel, Row, Screen } from '../ui/hud';

export default function LogScreen() {
  const navigation = useNavigation<any>();
  const [items, setItems] = useState<TimelineItem[] | null>(null);
  const [filter, setFilter] = useState<LogKind | 'all'>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [selectedMeal, setSelectedMeal] = useState<any | null>(null);

  const load = useCallback(async () => {
    setItems(await loadTimeline(7).catch(() => []));
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const groups = useMemo(
    () => groupByDay((items || []).filter((i) => filter === 'all' || i.kind === filter)),
    [items, filter]
  );

  return (
    <>
      <Screen
        title="Log"
        refreshing={refreshing}
        onRefresh={async () => {
          setRefreshing(true);
          await load();
          setRefreshing(false);
        }}
        right={
          <Pressable
            onPress={() => navigation.navigate('Meals')}
            hitSlop={10}
            accessibilityLabel="Meal gallery"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
          >
            <Ionicons name="images-outline" size={20} color={HUD.cyan} />
          </Pressable>
        }
      >
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {LOG_FILTERS.map((f) => (
            <Chip key={f.kind} label={f.label} selected={filter === f.kind} onPress={() => setFilter(f.kind)} />
          ))}
        </ScrollView>

        {items === null ? (
          <ActivityIndicator color={HUD.cyan} style={{ marginTop: 40 }} />
        ) : groups.length === 0 ? (
          <EmptyNote text="Nothing logged in the last 7 days. Use + to add an entry." />
        ) : (
          groups.map((g) => (
            <View key={g.day} style={{ gap: 8 }}>
              <Label color={HUD.inkSoft} style={{ marginTop: 4 }}>
                {g.day}
              </Label>
              <Panel style={{ paddingVertical: 4 }}>
                {g.items.map((it, i) => (
                  <Row
                    key={it.id}
                    first={i === 0}
                    icon={it.icon}
                    color={it.color}
                    title={it.title}
                    subtitle={it.subtitle}
                    trailing={timeLabel(it.ts)}
                    image={it.thumb}
                    onPress={it.meal ? () => setSelectedMeal(it.meal) : undefined}
                  />
                ))}
              </Panel>
            </View>
          ))
        )}
      </Screen>

      <MealDetailModal
        meal={selectedMeal}
        onClose={() => setSelectedMeal(null)}
        onSaved={() => {
          setSelectedMeal(null);
          void load();
        }}
      />
    </>
  );
}
