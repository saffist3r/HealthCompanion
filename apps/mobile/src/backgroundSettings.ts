import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_BACKGROUND_SETTINGS,
  parseBackgroundSettings,
  type BackgroundSettings,
} from '@health-companion/shared';

const BACKGROUND_SETTINGS_KEY = '@health_companion/background_settings';

export async function loadBackgroundSettings(): Promise<BackgroundSettings> {
  try {
    const raw = await AsyncStorage.getItem(BACKGROUND_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_BACKGROUND_SETTINGS };
    return parseBackgroundSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_BACKGROUND_SETTINGS };
  }
}

export async function saveBackgroundSettings(settings: BackgroundSettings): Promise<void> {
  const next = { ...settings, updatedAt: Date.now() };
  await AsyncStorage.setItem(BACKGROUND_SETTINGS_KEY, JSON.stringify(next));
}

export async function updateBackgroundSettings(
  patch: Partial<BackgroundSettings>
): Promise<BackgroundSettings> {
  const current = await loadBackgroundSettings();
  const next = { ...current, ...patch, updatedAt: Date.now() };
  await AsyncStorage.setItem(BACKGROUND_SETTINGS_KEY, JSON.stringify(next));
  return next;
}
