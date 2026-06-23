export type BackgroundType = 'animated' | 'solid' | 'gradient' | 'image';

export interface BackgroundSettings {
  type: BackgroundType;
  solidColor: string;
  gradientId: string;
  /** @deprecated Use imageIds — kept for backward compatibility. */
  imageId: string;
  /** Selected background images (presets and/or custom:N slots). Rotates when length > 1. */
  imageIds: string[];
  statusTint: boolean;
  /** Watch face text color (time, date, stats). Glycemia value keeps status color. */
  textColor: string;
  /** Seconds between slideshow images (when imageIds.length > 1). */
  slideshowIntervalSec: number;
  /** Phone-only local URIs for custom images; synced to watch as Wear assets. */
  customImageUris: string[];
  /** @deprecated Use customImageUris */
  customImageUri: string | null;
  updatedAt: number;
}

export const BACKGROUND_DATA_PATH = '/health_companion/background';

export const DEFAULT_BACKGROUND_SETTINGS: BackgroundSettings = {
  type: 'animated',
  solidColor: '#0D1117',
  gradientId: 'mint',
  imageId: 'teal',
  imageIds: ['teal'],
  statusTint: true,
  textColor: '#FFFFFF',
  slideshowIntervalSec: 30,
  customImageUris: [],
  customImageUri: null,
  updatedAt: 0,
};

/** Max custom gallery images synced to the watch. */
export const MAX_CUSTOM_BACKGROUND_IMAGES = 10;

export interface TextColorOption {
  id: string;
  label: string;
  color: string;
}

export const TEXT_COLOR_OPTIONS: TextColorOption[] = [
  { id: 'white', label: 'White', color: '#FFFFFF' },
  { id: 'soft', label: 'Soft white', color: '#E0E0E0' },
  { id: 'mint', label: 'Mint', color: '#80CBC4' },
  { id: 'cyan', label: 'Cyan', color: '#4DD0E1' },
  { id: 'gold', label: 'Gold', color: '#FFD54F' },
  { id: 'coral', label: 'Coral', color: '#FFAB91' },
];

export interface SolidColorOption {
  id: string;
  label: string;
  color: string;
}

export interface GradientPreset {
  id: string;
  label: string;
  colors: [string, string, string];
}

export interface ImagePreset {
  id: string;
  label: string;
}

export const SOLID_COLOR_OPTIONS: SolidColorOption[] = [
  { id: 'dark', label: 'Dark', color: '#0D1117' },
  { id: 'black', label: 'Black', color: '#000000' },
  { id: 'navy', label: 'Navy', color: '#0A1628' },
  { id: 'charcoal', label: 'Charcoal', color: '#1C1C1E' },
  { id: 'forest', label: 'Forest', color: '#0B1F12' },
  { id: 'wine', label: 'Wine', color: '#1A0A10' },
];

export const GRADIENT_PRESETS: GradientPreset[] = [
  { id: 'mint', label: 'Mint', colors: ['#0D1117', '#00897B', '#4DD0E1'] },
  { id: 'sunset', label: 'Sunset', colors: ['#1A0A0A', '#FF6B35', '#FFB74D'] },
  { id: 'lavender', label: 'Lavender', colors: ['#0D1117', '#5E35B1', '#B39DDB'] },
  { id: 'ocean', label: 'Ocean', colors: ['#0A1628', '#1565C0', '#4DD0E1'] },
  { id: 'midnight', label: 'Midnight', colors: ['#000000', '#1A237E', '#311B92'] },
];

export const IMAGE_PRESETS: ImagePreset[] = [
  { id: 'teal', label: 'Teal waves' },
  { id: 'sunset', label: 'Sunset glow' },
  { id: 'night', label: 'Night sky' },
  { id: 'ocean', label: 'Deep ocean' },
];

export const BACKGROUND_TYPE_LABELS: Record<BackgroundType, string> = {
  animated: 'Animated',
  solid: 'Solid color',
  gradient: 'Gradient',
  image: 'Image',
};

function parseStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === 'string');
}

export function normalizeImageIds(settings: Pick<BackgroundSettings, 'imageIds' | 'imageId'>): string[] {
  if (settings.imageIds?.length) return settings.imageIds;
  if (settings.imageId) return [settings.imageId];
  return [...DEFAULT_BACKGROUND_SETTINGS.imageIds];
}

export function parseBackgroundSettings(raw: unknown): BackgroundSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_BACKGROUND_SETTINGS };
  const o = raw as Record<string, unknown>;
  const type = o.type;
  const validType =
    type === 'animated' || type === 'solid' || type === 'gradient' || type === 'image'
      ? type
      : DEFAULT_BACKGROUND_SETTINGS.type;

  const legacyImageId =
    typeof o.imageId === 'string' ? o.imageId : DEFAULT_BACKGROUND_SETTINGS.imageId;
  const imageIdsRaw = parseStringArray(o.imageIds);
  const imageIds = imageIdsRaw.length > 0 ? imageIdsRaw : [legacyImageId];

  const legacyUri = typeof o.customImageUri === 'string' ? o.customImageUri : null;
  const customUrisRaw = parseStringArray(o.customImageUris);
  const customImageUris =
    customUrisRaw.length > 0 ? customUrisRaw : legacyUri ? [legacyUri] : [];

  const slideshowIntervalSec =
    typeof o.slideshowIntervalSec === 'number' && o.slideshowIntervalSec >= 5
      ? Math.min(o.slideshowIntervalSec, 300)
      : DEFAULT_BACKGROUND_SETTINGS.slideshowIntervalSec;

  return {
    type: validType,
    solidColor:
      typeof o.solidColor === 'string' ? o.solidColor : DEFAULT_BACKGROUND_SETTINGS.solidColor,
    gradientId:
      typeof o.gradientId === 'string' ? o.gradientId : DEFAULT_BACKGROUND_SETTINGS.gradientId,
    imageId: imageIds[0] ?? legacyImageId,
    imageIds,
    statusTint:
      typeof o.statusTint === 'boolean' ? o.statusTint : DEFAULT_BACKGROUND_SETTINGS.statusTint,
    textColor:
      typeof o.textColor === 'string' ? o.textColor : DEFAULT_BACKGROUND_SETTINGS.textColor,
    slideshowIntervalSec,
    customImageUris,
    customImageUri: customImageUris[0] ?? legacyUri,
    updatedAt: typeof o.updatedAt === 'number' ? o.updatedAt : Date.now(),
  };
}
