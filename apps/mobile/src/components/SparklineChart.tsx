import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import {
  GLYCEMIA_12H_MS,
  GLYCEMIA_24H_MS,
  sparklineBandY,
  sparklinePath,
  sparklineTrend,
  sparklineX,
  toSparklinePoints,
  toMgDl,
  type GlycemiaReading,
  type GlycemiaUnit,
} from '@health-companion/shared';
import type { GlycemiaChartEvent } from '../api/client';

const WIDTH = 300;
const HEIGHT = 110;

export type ChartRangeHours = 12 | 24 | 48;

const EVENT_COLORS: Record<GlycemiaChartEvent['type'], string> = {
  meal: '#f59e0b',
  insulin: '#3b82f6',
  pump: '#ef4444',
};

type Props = {
  history: GlycemiaReading[];
  color: string;
  isDark: boolean;
  rangeHours?: ChartRangeHours;
  onRangeChange?: (hours: ChartRangeHours) => void;
  events?: GlycemiaChartEvent[];
  showEvents?: boolean;
  onToggleEvents?: (show: boolean) => void;
};

function windowMsFor(hours: ChartRangeHours): number {
  if (hours === 24) return GLYCEMIA_24H_MS;
  if (hours === 48) return GLYCEMIA_24H_MS * 2;
  return GLYCEMIA_12H_MS;
}

function nearestY(
  points: { valueMgDl: number; timestamp: number }[],
  timestamp: number,
  layout: Parameters<typeof sparklineBandY>[1]
): number {
  if (!points.length) return sparklineBandY(140, layout);
  let best = points[0];
  let bestDist = Math.abs(points[0].timestamp - timestamp);
  for (const p of points) {
    const d = Math.abs(p.timestamp - timestamp);
    if (d < bestDist) {
      best = p;
      bestDist = d;
    }
  }
  return sparklineBandY(best.valueMgDl, layout);
}

export function SparklineChart({
  history,
  color,
  isDark,
  rangeHours = 12,
  onRangeChange,
  events = [],
  showEvents = false,
  onToggleEvents,
}: Props) {
  const now = Date.now();
  const windowMs = windowMsFor(rangeHours);
  const points = toSparklinePoints(history, (v, u) => toMgDl(v, u as GlycemiaUnit), now, windowMs);
  const muted = isDark ? 'rgba(255,255,255,0.55)' : '#888';
  const layout = {
    width: WIDTH,
    height: HEIGHT,
    paddingLeft: 28,
    paddingRight: 8,
    paddingTop: 10,
    paddingBottom: 22,
  };

  const windowStart = now - windowMs;
  const visibleEvents = showEvents
    ? events.filter((e) => e.timestamp >= windowStart && e.timestamp <= now)
    : [];

  return (
    <View>
      <View style={styles.controls}>
        {onRangeChange ? (
          <View style={styles.rangeRow}>
            {([12, 24, 48] as ChartRangeHours[]).map((h) => {
              const on = rangeHours === h;
              return (
                <TouchableOpacity
                  key={h}
                  style={[styles.rangeChip, on && styles.rangeChipOn]}
                  onPress={() => onRangeChange(h)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.rangeChipText, on && styles.rangeChipTextOn]}>{h}h</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : (
          <View />
        )}
        {onToggleEvents ? (
          <TouchableOpacity
            style={[styles.rangeChip, showEvents && styles.rangeChipOn]}
            onPress={() => onToggleEvents(!showEvents)}
            activeOpacity={0.8}
          >
            <Text style={[styles.rangeChipText, showEvents && styles.rangeChipTextOn]}>
              Events {showEvents ? 'on' : 'off'}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {points.length < 2 ? (
        <Text style={[styles.empty, { color: muted }]}>Not enough readings in this window yet.</Text>
      ) : (
        <>
          <View style={styles.headerRow}>
            <Text style={[styles.subtitle, { color: muted }]}>Last {rangeHours} hours</Text>
            {(() => {
              const trend = sparklineTrend(points);
              if (!trend) return null;
              return (
                <Text style={[styles.trend, { color }]}>
                  {trend === 'up' ? '↑ Rising' : trend === 'down' ? '↓ Falling' : '→ Stable'}
                </Text>
              );
            })()}
          </View>
          <Svg width={WIDTH} height={HEIGHT}>
            <Line
              x1={layout.paddingLeft}
              y1={sparklineBandY(70, layout)}
              x2={WIDTH - layout.paddingRight}
              y2={sparklineBandY(70, layout)}
              stroke="rgba(129,199,132,0.35)"
              strokeWidth={1}
            />
            <Line
              x1={layout.paddingLeft}
              y1={sparklineBandY(180, layout)}
              x2={WIDTH - layout.paddingRight}
              y2={sparklineBandY(180, layout)}
              stroke="rgba(129,199,132,0.35)"
              strokeWidth={1}
            />
            {visibleEvents.flatMap((e) => {
              const x = sparklineX(e.timestamp, layout, now, windowMs);
              const y = nearestY(points, e.timestamp, layout);
              const c = EVENT_COLORS[e.type] || '#64748b';
              return [
                <Line
                  key={`${e.id}-line`}
                  x1={x}
                  y1={layout.paddingTop}
                  x2={x}
                  y2={HEIGHT - layout.paddingBottom}
                  stroke={c}
                  strokeWidth={1.25}
                  strokeDasharray="4 3"
                  opacity={0.8}
                />,
                <Circle
                  key={`${e.id}-dot`}
                  cx={x}
                  cy={y}
                  r={3.5}
                  fill={c}
                  stroke={isDark ? '#0d1117' : '#fff'}
                  strokeWidth={1}
                />,
              ];
            })}
            <Path
              d={sparklinePath(points, layout, now, windowMs)}
              stroke={color}
              strokeWidth={2.5}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
          <View style={[styles.axisRow, { paddingLeft: layout.paddingLeft, paddingRight: layout.paddingRight }]}>
            <Text style={[styles.axis, { color: muted }]}>-{rangeHours}h</Text>
            <Text style={[styles.axis, { color: muted }]}>now</Text>
          </View>
          {showEvents ? (
            <View style={styles.legendRow}>
              <Text style={[styles.legendItem, { color: EVENT_COLORS.meal }]}>● Meal</Text>
              <Text style={[styles.legendItem, { color: EVENT_COLORS.insulin }]}>● Insulin</Text>
              <Text style={[styles.legendItem, { color: EVENT_COLORS.pump }]}>● Alert</Text>
              <Text style={[styles.hint, { color: muted }]}>
                {visibleEvents.length} event{visibleEvents.length === 1 ? '' : 's'}
              </Text>
            </View>
          ) : (
            <Text style={[styles.hint, { color: muted }]}>Fixed scale 50–300 mg/dL</Text>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
    flexWrap: 'wrap',
  },
  rangeRow: { flexDirection: 'row', gap: 8 },
  rangeChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(13,148,136,0.12)',
  },
  rangeChipOn: { backgroundColor: '#0d9488' },
  rangeChipText: { fontSize: 13, fontWeight: '600', color: '#0d9488' },
  rangeChipTextOn: { color: '#fff' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  subtitle: { fontSize: 13, fontWeight: '600' },
  trend: { fontSize: 13, fontWeight: '700' },
  axisRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -18 },
  axis: { fontSize: 11 },
  hint: { fontSize: 11, marginTop: 4 },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 6, alignItems: 'center' },
  legendItem: { fontSize: 11, fontWeight: '600' },
  empty: { fontSize: 14, paddingVertical: 16 },
});
