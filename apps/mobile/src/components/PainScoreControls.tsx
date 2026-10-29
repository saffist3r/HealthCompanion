import { useEffect, useMemo, useRef, useState } from 'react';
import {
  LayoutChangeEvent,
  PanResponder,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';

export function painColor(score: number) {
  if (score >= 8) return '#be123c';
  if (score >= 6) return '#e11d48';
  if (score >= 4) return '#f59e0b';
  if (score >= 2) return '#84cc16';
  return '#10b981';
}

export function painWord(score: number): string {
  if (score <= 0) return 'None';
  if (score <= 2) return 'Mild';
  if (score <= 4) return 'Moderate';
  if (score <= 6) return 'Strong';
  if (score <= 8) return 'Severe';
  return 'Worst';
}

export const PAIN_PRESETS: Array<{ score: number; label: string }> = [
  { score: 0, label: 'None' },
  { score: 2, label: 'Mild' },
  { score: 4, label: 'Moderate' },
  { score: 6, label: 'Strong' },
  { score: 8, label: 'Severe' },
  { score: 10, label: 'Worst' },
];

export function ScoreSlider({
  value,
  onChange,
  isDark,
  label,
  max,
  colorFor,
  lowLabel,
  highLabel,
  compact,
}: {
  value: number;
  onChange: (n: number) => void;
  isDark: boolean;
  label: string;
  max: number;
  colorFor: (n: number) => string;
  lowLabel: string;
  highLabel: string;
  compact?: boolean;
}) {
  const [trackWidth, setTrackWidth] = useState(1);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const widthRef = useRef(1);
  const lastHaptic = useRef(value);

  const scoreFromX = (x: number) => {
    const w = widthRef.current || 1;
    return Math.round(Math.max(0, Math.min(max, (x / w) * max)));
  };

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => onChangeRef.current(scoreFromX(e.nativeEvent.locationX)),
        onPanResponderMove: (e) => onChangeRef.current(scoreFromX(e.nativeEvent.locationX)),
      }),
    [max]
  );

  useEffect(() => {
    if (lastHaptic.current === value) return;
    lastHaptic.current = value;
    void Haptics.selectionAsync().catch(() => {});
  }, [value]);

  const color = colorFor(value);
  const thumbSize = compact ? 24 : 28;
  const trackH = compact ? 32 : 36;
  const thumbLeft = Math.max(
    0,
    Math.min(trackWidth - thumbSize, (value / max) * trackWidth - thumbSize / 2)
  );

  return (
    <View style={{ marginBottom: compact ? 4 : 12 }}>
      {!compact ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            marginBottom: 8,
          }}
        >
          <Text style={{ color: isDark ? '#8CA0BC' : '#666', fontSize: 13, fontWeight: '600' }}>
            {label}
          </Text>
          <Text style={{ color, fontSize: 28, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
            {value}
            <Text style={{ fontSize: 14, fontWeight: '600', color: isDark ? '#8CA0BC' : '#9ca3af' }}>
              {' '}
              / {max}
            </Text>
          </Text>
        </View>
      ) : null}
      <View
        onLayout={(e: LayoutChangeEvent) => {
          const w = e.nativeEvent.layout.width;
          widthRef.current = w;
          setTrackWidth(w);
        }}
        {...pan.panHandlers}
        style={{
          height: trackH,
          borderRadius: trackH / 2,
          backgroundColor: isDark ? '#16233A' : '#e5e7eb',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min: 0, max, now: value }}
      >
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: (value / max) * trackWidth,
            backgroundColor: color,
            opacity: 0.85,
            borderRadius: trackH / 2,
          }}
        />
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: thumbLeft,
            width: thumbSize,
            height: thumbSize,
            borderRadius: thumbSize / 2,
            backgroundColor: '#fff',
            borderWidth: 2,
            borderColor: color,
            top: (trackH - thumbSize) / 2,
            shadowColor: '#000',
            shadowOpacity: 0.15,
            shadowRadius: 3,
            elevation: 2,
          }}
        />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
        <Text style={{ color: isDark ? '#6e7681' : '#9ca3af', fontSize: 11 }}>{lowLabel}</Text>
        <Text style={{ color: isDark ? '#6e7681' : '#9ca3af', fontSize: 11 }}>{highLabel}</Text>
      </View>
    </View>
  );
}

/** Compact card control for batch pain logging — slider primary, presets for speed. */
export function InjuryPainCard({
  title,
  subtitle,
  value,
  onChange,
  isDark,
  focused,
}: {
  title: string;
  subtitle?: string;
  value: number;
  onChange: (n: number) => void;
  isDark: boolean;
  focused?: boolean;
}) {
  const color = painColor(value);
  return (
    <View
      style={{
        borderRadius: 16,
        padding: 14,
        backgroundColor: isDark ? '#0E1624' : '#fff',
        borderWidth: focused ? 2 : 1,
        borderColor: focused ? color : isDark ? '#1E3350' : '#e2e8f0',
        marginBottom: 12,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
        <View style={{ flex: 1, paddingRight: 10 }}>
          <Text
            style={{
              color: isDark ? '#E6F4FF' : '#111',
              fontSize: 16,
              fontWeight: '700',
            }}
            numberOfLines={2}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text style={{ color: isDark ? '#8CA0BC' : '#64748b', fontSize: 12, marginTop: 2 }}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text
            style={{
              color,
              fontSize: 36,
              fontWeight: '800',
              fontVariant: ['tabular-nums'],
              lineHeight: 40,
            }}
          >
            {value}
          </Text>
          <Text style={{ color, fontSize: 13, fontWeight: '700' }}>{painWord(value)}</Text>
        </View>
      </View>

      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 6,
          marginBottom: 10,
        }}
      >
        {PAIN_PRESETS.map((p) => {
          const active =
            p.score === 0
              ? value === 0
              : p.score === 10
                ? value >= 9
                : Math.abs(value - p.score) <= 1 && value !== 0;
          return (
            <TouchableOpacity
              key={p.score}
              onPress={() => onChange(p.score)}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 999,
                backgroundColor: active
                  ? painColor(p.score)
                  : isDark
                    ? '#16233A'
                    : '#f1f5f9',
              }}
            >
              <Text
                style={{
                  color: active ? '#fff' : isDark ? '#c9d1d9' : '#475569',
                  fontWeight: active ? '700' : '600',
                  fontSize: 12,
                }}
              >
                {p.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScoreSlider
        value={value}
        onChange={onChange}
        isDark={isDark}
        label="Pain"
        max={10}
        colorFor={painColor}
        lowLabel="None"
        highLabel="Worst"
        compact
      />
    </View>
  );
}
