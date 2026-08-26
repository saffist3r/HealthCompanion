import { useColorScheme } from 'react-native';

/** Life Review–aligned design tokens for the mobile app. */
export const HC = {
  teal: '#0d9488',
  tealDeep: '#042f2e',
  tealMid: '#0f766e',
  tealBright: '#5eead4',
  tealWash: '#ccfbf1',
  tealWashDark: '#0f3d38',
  violet: '#7c3aed',
  amber: '#d97706',
  win: '#059669',
  danger: '#E57373',
  heroGradient: ['#021a19', '#0f766e', '#1e1b4b'] as [string, string, string],
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
    bg: isDark ? '#0d1117' : '#f3f7f6',
    card: isDark ? '#161b22' : '#fff',
    border: isDark ? '#30363d' : '#e2e8f0',
    borderSoft: isDark ? '#21262d' : '#e2e8f0',
    ink: isDark ? '#e6edf3' : '#0f172a',
    muted: isDark ? '#8b949e' : '#64748b',
    line: isDark ? '#c9d1d9' : '#334155',
  };
}

export function useThemeColors(): ThemeColors & { isDark: boolean } {
  const isDark = useColorScheme() === 'dark';
  return { ...themeColors(isDark), isDark };
}
