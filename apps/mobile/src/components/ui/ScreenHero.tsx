import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HC } from '../../theme';

type Props = {
  eyebrow: string;
  title: string;
  subtitle?: string;
  pills?: string[];
  children?: React.ReactNode;
  style?: ViewStyle;
  /** Extra top padding beyond safe area (default 8). */
  padTop?: number;
  compact?: boolean;
};

/** Full-bleed teal→indigo hero matching Life Review. */
export default function ScreenHero({
  eyebrow,
  title,
  subtitle,
  pills,
  children,
  style,
  padTop = 8,
  compact,
}: Props) {
  const insets = useSafeAreaInsets();
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 1000, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <LinearGradient
      colors={HC.heroGradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[
        styles.hero,
        compact && styles.heroCompact,
        { paddingTop: insets.top + padTop },
        style,
      ]}
    >
      <View style={styles.mesh} pointerEvents="none" />
      <View style={styles.eyebrowRow}>
        <Animated.View style={[styles.dot, { opacity: pulse }]} />
        <Text style={styles.eyebrow}>{eyebrow}</Text>
      </View>
      <Text style={[styles.title, compact && styles.titleCompact]}>{title}</Text>
      {subtitle ? <Text style={styles.sub}>{subtitle}</Text> : null}
      {pills && pills.length > 0 ? (
        <View style={styles.pillRow}>
          {pills.map((p) => (
            <View key={p} style={styles.pill}>
              <Text style={styles.pillText}>{p}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {children}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  hero: {
    paddingHorizontal: 24,
    paddingBottom: 22,
    borderBottomLeftRadius: HC.radius.hero,
    borderBottomRightRadius: HC.radius.hero,
    overflow: 'hidden',
    marginBottom: 16,
  },
  heroCompact: {
    paddingBottom: 16,
    marginBottom: 12,
  },
  mesh: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.4,
  },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: HC.tealBright,
  },
  eyebrow: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  title: {
    color: '#fff',
    fontSize: 30,
    fontWeight: '700',
    lineHeight: 36,
    marginBottom: 8,
    letterSpacing: -0.5,
  },
  titleCompact: { fontSize: 26, lineHeight: 32 },
  sub: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 12,
  },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: HC.radius.pill,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  pillText: { color: '#fff', fontSize: 11, fontWeight: '700' },
});
