import { useColorScheme } from 'react-native';

/** Life Review–aligned design tokens for the mobile app. */
export const HC = {
  teal: '#0891B2',
  tealDeep: '#0A1A2E',
  tealMid: '#0E7490',
  tealBright: '#22D3EE',
  tealWash: '#ccfbf1',
  tealWashDark: '#0B2E3A',
  violet: '#7c3aed',
  amber: '#d97706',
  win: '#059669',
  danger: '#E57373',
  heroGradient: ['#070B14', '#0E7490', '#1B1440'] as [string, string, string],
  radius: {
    sm: 10,
    md: 16,
    lg: 18,
    xl: 20,
    hero: 28,
    pill: 999,
  },
} as const;

export type ThemeColors = {
  bg: string;
  card: string;
  border: string;
  borderSoft: string;
  ink: string;
  muted: string;
  line: string;
};

export function themeColors(isDark: boolean): ThemeColors {
  return {
    bg: isDark ? '#070B14' : '#f3f7f6',
    card: isDark ? '#0E1624' : '#fff',
    border: isDark ? '#1E3350' : '#e2e8f0',
    borderSoft: isDark ? '#16233A' : '#e2e8f0',
    ink: isDark ? '#E6F4FF' : '#0f172a',
    muted: isDark ? '#8CA0BC' : '#64748b',
    line: isDark ? '#c9d1d9' : '#334155',
  };
}

export function useThemeColors(): ThemeColors & { isDark: boolean } {
  const isDark = useColorScheme() === 'dark';
  return { ...themeColors(isDark), isDark };
}
