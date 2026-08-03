/** App UI + report language. English is the default / archive language. */
export type Locale = 'en' | 'fr';

export const LOCALES: { id: Locale; label: string; nativeLabel: string }[] = [
  { id: 'en', label: 'English', nativeLabel: 'English' },
  { id: 'fr', label: 'French', nativeLabel: 'Français' },
];

export const DEFAULT_LOCALE: Locale = 'en';

export function normalizeLocale(value: unknown): Locale {
  const v = String(value || '')
    .trim()
    .toLowerCase()
    .slice(0, 2);
  return v === 'fr' ? 'fr' : 'en';
}
