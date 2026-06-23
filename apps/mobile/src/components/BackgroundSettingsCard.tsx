import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import type { BackgroundSettings, BackgroundType } from '@health-companion/shared';
import {
  BACKGROUND_TYPE_LABELS,
  GRADIENT_PRESETS,
  IMAGE_PRESETS,
  MAX_CUSTOM_BACKGROUND_IMAGES,
  normalizeImageIds,
  SOLID_COLOR_OPTIONS,
  TEXT_COLOR_OPTIONS,
} from '@health-companion/shared';
import { loadBackgroundSettings, updateBackgroundSettings } from '../backgroundSettings';
import { sendBackgroundToWatch } from '../wearSync';

const TYPES: BackgroundType[] = ['animated', 'solid', 'gradient', 'image'];
const SLIDESHOW_INTERVALS = [15, 30, 60, 120];

function toggleImageId(ids: string[], id: string): string[] {
  if (ids.includes(id)) {
    if (ids.length <= 1) return ids;
    return ids.filter((x) => x !== id);
  }
  return [...ids, id];
}

type Props = {
  isDark: boolean;
};

export function BackgroundSettingsCard({ isDark }: Props) {
  const [settings, setSettings] = useState<BackgroundSettings | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    loadBackgroundSettings().then(async (s) => {
      setSettings(s);
      await sendBackgroundToWatch(s);
    });
  }, []);

  const apply = async (patch: Partial<BackgroundSettings>) => {
    const next = await updateBackgroundSettings(patch);
    const imageIds =
      normalizeImageIds?.(next) ??
      (next.imageIds?.length ? next.imageIds : [next.imageId ?? 'teal']);
    const normalized = {
      ...next,
      imageIds,
      imageId: imageIds[0] ?? next.imageId,
    };
    setSettings(normalized);
    setSyncing(true);
    setSynced(false);
    try {
      await sendBackgroundToWatch(normalized);
      setSynced(true);
      setTimeout(() => setSynced(false), 2500);
    } finally {
      setSyncing(false);
    }
  };

  const pickCustomImages = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsMultipleSelection: true,
      selectionLimit: MAX_CUSTOM_BACKGROUND_IMAGES,
    });
    if (result.canceled || result.assets.length === 0) return;
    const uris = result.assets.map((a) => a.uri).filter(Boolean) as string[];
    const customIds = uris.map((_, i) => `custom:${i}`);
    const presetIds = (
      normalizeImageIds?.(settings ?? { imageIds: [], imageId: 'teal' }) ??
      settings?.imageIds ??
      ['teal']
    ).filter((id) => !id.startsWith('custom:'));
    const imageIds = [...presetIds, ...customIds];
    await apply({
      type: 'image',
      imageIds,
      imageId: imageIds[0],
      customImageUris: uris,
      customImageUri: uris[0] ?? null,
    });
  };

  if (!settings) {
    return (
      <View style={[styles.card, isDark && styles.cardDark]}>
        <ActivityIndicator color="#007AFF" />
      </View>
    );
  }

  const text = isDark ? '#fff' : '#1a1a2e';
  const muted = isDark ? 'rgba(255,255,255,0.65)' : '#666';
  const selectedImages = normalizeImageIds?.(settings) ?? (
    settings.imageIds?.length ? settings.imageIds : [settings.imageId ?? 'teal']
  );
  const customUris = settings.customImageUris ?? (settings.customImageUri ? [settings.customImageUri] : []);
  const textColor = settings.textColor ?? '#FFFFFF';

  return (
    <View style={[styles.card, isDark && styles.cardDark]}>
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: text }]}>Watch background</Text>
        {syncing && <ActivityIndicator size="small" color="#007AFF" />}
        {synced && !syncing && <Text style={styles.synced}>Synced</Text>}
      </View>
      <Text style={[styles.hint, { color: muted }]}>
        Applies to the watch app and watch face. Swipe to Settings on the watch to tweak locally.
      </Text>

      <Text style={[styles.label, { color: muted }]}>Style</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
        {TYPES.map((type) => (
          <TouchableOpacity
            key={type}
            style={[styles.chip, settings.type === type && styles.chipActive]}
            onPress={() => apply({ type })}
          >
            <Text style={[styles.chipText, settings.type === type && styles.chipTextActive]}>
              {BACKGROUND_TYPE_LABELS[type]}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Text style={[styles.label, { color: muted }]}>Text color</Text>
      <View style={styles.swatchRow}>
        {TEXT_COLOR_OPTIONS.map((opt) => (
          <TouchableOpacity
            key={opt.id}
            style={[
              styles.swatch,
              { backgroundColor: opt.color },
              settings.textColor?.toLowerCase() === opt.color.toLowerCase() && styles.swatchSelected,
            ]}
            onPress={() => apply({ textColor: opt.color })}
          />
        ))}
      </View>

      <View style={styles.toggleRow}>
        <Text style={[styles.label, { color: text, marginBottom: 0 }]}>Status color tint</Text>
        <Switch
          value={settings.statusTint}
          onValueChange={(statusTint) => apply({ statusTint })}
        />
      </View>

      {settings.type === 'solid' && (
        <>
          <Text style={[styles.label, { color: muted }]}>Solid color</Text>
          <View style={styles.swatchRow}>
            {SOLID_COLOR_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.id}
                style={[
                  styles.swatch,
                  { backgroundColor: opt.color },
                  settings.solidColor.toLowerCase() === opt.color.toLowerCase() && styles.swatchSelected,
                ]}
                onPress={() => apply({ solidColor: opt.color })}
              />
            ))}
          </View>
        </>
      )}

      {settings.type === 'gradient' && (
        <>
          <Text style={[styles.label, { color: muted }]}>Gradient</Text>
          {GRADIENT_PRESETS.map((preset) => (
            <TouchableOpacity
              key={preset.id}
              style={[
                styles.gradientRow,
                settings.gradientId === preset.id && styles.gradientRowSelected,
              ]}
              onPress={() => apply({ gradientId: preset.id })}
            >
              <LinearGradient
                colors={preset.colors}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.gradientFill}
              />
              <Text style={styles.gradientLabel}>{preset.label}</Text>
            </TouchableOpacity>
          ))}
        </>
      )}

      {settings.type === 'image' && (
        <>
          <Text style={[styles.label, { color: muted }]}>
            Images — tap to select multiple ({selectedImages.length} selected)
          </Text>
          {selectedImages.length > 1 && (
            <>
              <Text style={[styles.label, { color: muted }]}>Slideshow interval</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
                {SLIDESHOW_INTERVALS.map((sec) => (
                  <TouchableOpacity
                    key={sec}
                    style={[
                      styles.chip,
                      settings.slideshowIntervalSec === sec && styles.chipActive,
                    ]}
                    onPress={() => apply({ slideshowIntervalSec: sec })}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        settings.slideshowIntervalSec === sec && styles.chipTextActive,
                      ]}
                    >
                      {sec}s
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </>
          )}
          {IMAGE_PRESETS.map((preset) => {
            const selected = selectedImages.includes(preset.id);
            return (
              <TouchableOpacity
                key={preset.id}
                style={[styles.imageRow, selected && styles.imageRowSelected]}
                onPress={() => {
                  const imageIds = toggleImageId(selectedImages, preset.id);
                  apply({ type: 'image', imageIds, imageId: imageIds[0] });
                }}
              >
                <Text style={{ color: text }}>
                  {selected ? '✓ ' : ''}
                  {preset.label}
                </Text>
              </TouchableOpacity>
            );
          })}
          {customUris.length > 0 &&
            customUris.map((_, i) => {
              const slotId = `custom:${i}`;
              const selected = selectedImages.includes(slotId);
              return (
                <TouchableOpacity
                  key={slotId}
                  style={[styles.imageRow, selected && styles.imageRowSelected]}
                  onPress={() => {
                    const imageIds = toggleImageId(selectedImages, slotId);
                    apply({ imageIds, imageId: imageIds[0] });
                  }}
                >
                  <Text style={{ color: text }}>
                    {selected ? '✓ ' : ''}
                    Custom photo {i + 1}
                  </Text>
                </TouchableOpacity>
              );
            })}
          <TouchableOpacity style={styles.customButton} onPress={pickCustomImages}>
            <Text style={styles.customButtonText}>
              {customUris.length > 0
                ? 'Change gallery photos'
                : 'Choose photos from gallery'}
            </Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 18,
    marginBottom: 16,
  },
  cardDark: { backgroundColor: '#161B22' },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  title: { fontSize: 16, fontWeight: '600', flex: 1 },
  hint: { fontSize: 13, marginBottom: 12, lineHeight: 18 },
  label: { fontSize: 13, fontWeight: '600', marginBottom: 8, marginTop: 4 },
  chipRow: { marginBottom: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(0,122,255,0.12)',
    marginRight: 8,
  },
  chipActive: { backgroundColor: '#007AFF' },
  chipText: { fontSize: 13, color: '#007AFF', fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: 8,
  },
  swatchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 4 },
  swatch: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  swatchSelected: { borderColor: '#007AFF' },
  gradientRow: {
    borderRadius: 10,
    overflow: 'hidden',
    marginBottom: 8,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  gradientRowSelected: { borderColor: '#007AFF' },
  gradientFill: { height: 44, justifyContent: 'flex-end', padding: 8 },
  gradientLabel: { color: '#fff', fontWeight: '600', fontSize: 13 },
  imageRow: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(128,203,196,0.15)',
    marginBottom: 6,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  imageRowSelected: { borderColor: '#007AFF' },
  customButton: {
    marginTop: 8,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: 'rgba(0,122,255,0.12)',
  },
  customButtonText: { color: '#007AFF', fontWeight: '600', fontSize: 14 },
  synced: { color: '#81C784', fontSize: 13, fontWeight: '600' },
});
