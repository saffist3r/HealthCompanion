/**
 * HUD design kit: the phone's look, matched to the logo and the watch face.
 * Dark navy canvas, cyan/mint neon accents, condensed spaced labels, glow on live values.
 */
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { GlucoseZone } from '@health-companion/shared';

export const HUD = {
  bg: '#070B14',
  panel: '#0E1624',
  panelRaised: '#132036',
  line: '#1E3350',
  lineSoft: '#16233A',
  ink: '#E6F4FF',
  inkSoft: '#B7C8DE',
  muted: '#8CA0BC',
  dim: '#5B6B82',
  cyan: '#00E5FF',
  mint: '#2EF2B5',
  amber: '#FFB547',
  red: '#FF4D6D',
  urgent: '#FF1F4B',
  violet: '#9D8CFF',
  /** Solid accent for filled controls (white text stays readable on it). */
  accent: '#0891B2',
  accentDeep: '#0E7490',
  radius: 16,
  fontCondensed: 'sans-serif-condensed',
  fontLight: 'sans-serif-light',
  fontThin: 'sans-serif-thin',
} as const;

/** Same zone colours as the watch face. */
export function zoneColor(zone: GlucoseZone | null | undefined): string {
  switch (zone) {
    case 'urgentLow':
      return HUD.urgent;
    case 'low':
    case 'veryHigh':
      return HUD.red;
    case 'inRange':
      return HUD.mint;
    case 'high':
      return HUD.amber;
    default:
      return HUD.dim;
  }
}

export function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}

export type IconName = keyof typeof Ionicons.glyphMap;

/** Full-screen scroll canvas with pull-to-refresh and room above the tab bar. */
export function Screen({
  children,
  refreshing,
  onRefresh,
  title,
  right,
  padTop = true,
}: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  title?: string;
  right?: ReactNode;
  padTop?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: HUD.bg }}
      contentContainerStyle={{
        paddingTop: padTop ? insets.top + 12 : 12,
        paddingHorizontal: 16,
        paddingBottom: 120,
        gap: 14,
      }}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={!!refreshing}
            onRefresh={onRefresh}
            tintColor={HUD.cyan}
            colors={[HUD.cyan]}
            progressBackgroundColor={HUD.panel}
          />
        ) : undefined
      }
    >
      {title ? (
        <View style={s.titleRow}>
          <Text style={s.screenTitle}>{title}</Text>
          {right}
        </View>
      ) : null}
      {children}
    </ScrollView>
  );
}

/** Small spaced capitals, like the watch face's labels. */
export function Label({
  children,
  color = HUD.muted,
  style,
}: {
  children: ReactNode;
  color?: string;
  style?: StyleProp<TextStyle>;
}) {
  return <Text style={[s.label, { color }, style]}>{children}</Text>;
}

/** Thin-bordered panel with a faint cyan edge. */
export function Panel({
  children,
  style,
  glow,
  onPress,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Tint the edge with this colour (alerts, live values). */
  glow?: string;
  onPress?: () => void;
}) {
  const edge = glow ? withAlpha(glow, 0.55) : HUD.line;
  const body = (
    <View style={[s.panel, { borderColor: edge }, glow ? { shadowColor: glow } : null, style]}>
      {children}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => (pressed ? { opacity: 0.8 } : null)}>
      {body}
    </Pressable>
  );
}

/** Section heading with an optional "See all" style action. */
export function SectionHeader({
  title,
  action,
  onAction,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={s.sectionRow}>
      <Label color={HUD.inkSoft}>{title}</Label>
      {action && onAction ? (
        <Pressable onPress={onAction} hitSlop={10}>
          <Text style={s.sectionAction}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Rounded square icon in a tinted well. */
export function IconWell({ name, color, size = 34 }: { name: IconName; color: string; size?: number }) {
  return (
    <View
      style={[
        s.iconWell,
        { width: size, height: size, borderRadius: size * 0.3, backgroundColor: withAlpha(color, 0.14), borderColor: withAlpha(color, 0.35) },
      ]}
    >
      <Ionicons name={name} size={size * 0.52} color={color} />
    </View>
  );
}

/** One line in a list: icon, title, optional subtitle, trailing text. */
export function Row({
  icon,
  color = HUD.cyan,
  title,
  subtitle,
  trailing,
  onPress,
  chevron,
  first,
  image,
}: {
  icon: IconName;
  color?: string;
  title: string;
  subtitle?: string | null;
  trailing?: string | null;
  onPress?: () => void;
  chevron?: boolean;
  /** Skip the top divider. */
  first?: boolean;
  /** Photo shown instead of the icon (e.g. a meal). */
  image?: string;
}) {
  const content = (
    <View style={[s.row, first ? null : s.rowDivider]}>
      {image ? (
        <Image source={{ uri: image }} style={s.rowImage} resizeMethod="resize" />
      ) : (
        <IconWell name={icon} color={color} />
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={s.rowSub} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing ? <Text style={s.rowTrailing}>{trailing}</Text> : null}
      {chevron ? <Ionicons name="chevron-forward" size={18} color={HUD.dim} /> : null}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)}>
      {content}
    </Pressable>
  );
}

/** Compact number tile for 2-column grids. */
export function Stat({
  label,
  value,
  unit,
  color = HUD.ink,
  hint,
}: {
  label: string;
  value: string;
  unit?: string;
  color?: string;
  hint?: string | null;
}) {
  return (
    <View style={s.stat}>
      <Label>{label}</Label>
      <Text style={[s.statValue, { color }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
        {unit ? <Text style={s.statUnit}> {unit}</Text> : null}
      </Text>
      {hint ? (
        <Text style={s.statHint} numberOfLines={1}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <View style={s.grid}>{children}</View>;
}

/** Selectable pill (filters, segmented choices). */
export function Chip({
  label,
  selected,
  onPress,
  icon,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[s.chip, selected ? s.chipOn : null]}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
    >
      {icon ? <Ionicons name={icon} size={14} color={selected ? HUD.bg : HUD.inkSoft} /> : null}
      <Text style={[s.chipText, selected ? s.chipTextOn : null]}>{label}</Text>
    </Pressable>
  );
}

/** Alert/status pill, e.g. "HIGH IN ~8 MIN". */
export function Pill({ label, color }: { label: string; color: string }) {
  return (
    <View style={[s.pill, { backgroundColor: withAlpha(color, 0.16), borderColor: withAlpha(color, 0.6) }]}>
      <Text style={[s.pillText, { color }]}>{label}</Text>
    </View>
  );
}

export function Button({
  label,
  onPress,
  icon,
  variant = 'primary',
  busy,
}: {
  label: string;
  onPress: () => void;
  icon?: IconName;
  variant?: 'primary' | 'ghost';
  busy?: boolean;
}) {
  const primary = variant === 'primary';
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [s.button, primary ? s.buttonPrimary : s.buttonGhost, pressed ? { opacity: 0.8 } : null]}
    >
      {busy ? (
        <ActivityIndicator color={primary ? '#fff' : HUD.cyan} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={18} color={primary ? '#fff' : HUD.cyan} /> : null}
          <Text style={[s.buttonText, { color: primary ? '#fff' : HUD.cyan }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

export function EmptyNote({ text }: { text: string }) {
  return <Text style={s.empty}>{text}</Text>;
}

const s = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  screenTitle: { fontFamily: HUD.fontLight, fontSize: 30, color: HUD.ink, letterSpacing: 0.5 },
  label: {
    fontFamily: HUD.fontCondensed,
    fontWeight: '700',
    fontSize: 11,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
  },
  panel: {
    backgroundColor: HUD.panel,
    borderRadius: HUD.radius,
    borderWidth: 1,
    padding: 16,
    shadowOpacity: 0.6,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
  },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  sectionAction: { color: HUD.cyan, fontFamily: HUD.fontCondensed, fontSize: 13, letterSpacing: 0.6 },
  iconWell: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11 },
  rowImage: { width: 44, height: 44, borderRadius: 12, backgroundColor: HUD.panelRaised },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: HUD.line },
  rowTitle: { color: HUD.ink, fontSize: 15 },
  rowSub: { color: HUD.muted, fontSize: 12.5, marginTop: 2 },
  rowTrailing: { color: HUD.muted, fontFamily: HUD.fontCondensed, fontSize: 13 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  stat: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: HUD.panel,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: HUD.lineSoft,
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 4,
  },
  statValue: { fontFamily: HUD.fontLight, fontSize: 28 },
  statUnit: { fontFamily: HUD.fontCondensed, fontSize: 13, color: HUD.muted },
  statHint: { color: HUD.dim, fontSize: 11.5 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: HUD.line,
    backgroundColor: HUD.panel,
  },
  chipOn: { backgroundColor: HUD.cyan, borderColor: HUD.cyan },
  chipText: { color: HUD.inkSoft, fontFamily: HUD.fontCondensed, fontSize: 13, letterSpacing: 0.4 },
  chipTextOn: { color: HUD.bg, fontWeight: '700' },
  pill: { alignSelf: 'flex-start', borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 5 },
  pillText: { fontFamily: HUD.fontCondensed, fontWeight: '700', fontSize: 14, letterSpacing: 1.2 },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 16,
  },
  buttonPrimary: { backgroundColor: HUD.accent },
  buttonGhost: { borderWidth: 1, borderColor: withAlpha(HUD.cyan, 0.5) },
  buttonText: { fontFamily: HUD.fontCondensed, fontWeight: '700', fontSize: 15, letterSpacing: 0.8 },
  empty: { color: HUD.muted, fontSize: 14, paddingVertical: 10 },
});
