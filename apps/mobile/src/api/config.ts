import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@health_companion/api_base_url';

/** Production API (cluster). Override in Settings for local debugging. */
export const DEFAULT_API_BASE_URL = 'http://localhost:8000';

const LEGACY_DEFAULTS = new Set([
  'http://10.0.2.2:8000',
  'http://127.0.0.1:8000',
  'http://localhost:8000',
  'http://10.0.2.2:8787',
  'http://127.0.0.1:8787',
  'http://localhost:8787',
]);

export async function getApiBaseUrl(): Promise<string> {
  const stored = await AsyncStorage.getItem(KEY);
  const normalized = (stored || '').replace(/\/$/, '');
  if (!normalized || LEGACY_DEFAULTS.has(normalized)) {
    return DEFAULT_API_BASE_URL;
  }
  return normalized;
}

export async function setApiBaseUrl(url: string): Promise<void> {
  await AsyncStorage.setItem(KEY, url.replace(/\/$/, ''));
}
