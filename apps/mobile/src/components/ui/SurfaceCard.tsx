import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { HC, themeColors } from '../../theme';

type Props = {
  isDark: boolean;
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  title?: string;
  accent?: 'teal' | 'violet' | 'amber' | 'win' | 'none';
};

const ACCENT: Record<NonNullable<Props['accent']>, string | undefined> = {
  teal: HC.teal,
  violet: HC.violet,
  amber: HC.amber,
  win: HC.win,
  none: undefined,
};

/** Bordered surface card matching Life Review result cards. */
export default function SurfaceCard({
  isDark,
  children,
  style,
  title,
  accent = 'none',
}: Props) {
  const c = themeColors(isDark);
  const left = ACCENT[accent];
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: c.card,
          borderColor: c.border,
          borderLeftWidth: left ? 4 : 1,
          borderLeftColor: left || c.border,
        },
        style,
      ]}
    >
      {title ? <Text style={[styles.title, { color: c.ink }]}>{title}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: HC.radius.lg,
    padding: 16,
    borderWidth: 1,
    marginBottom: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 10,
  },
});
