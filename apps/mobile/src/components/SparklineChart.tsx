import { View, Text, StyleSheet } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';
import {
  SPARKLINE_WINDOW_MS,
  sparklineBandY,
  sparklinePath,
  sparklineTrend,
  toSparklinePoints,
  toMgDl,
  type GlycemiaReading,
} from '@health-companion/shared';

const WIDTH = 300;
const HEIGHT = 110;

type Props = {
  history: GlycemiaReading[];
  color: string;
  isDark: boolean;
};

export function SparklineChart({ history, color, isDark }: Props) {
  const now = Date.now();
  const points = toSparklinePoints(history, toMgDl, now);
  if (points.length < 2) return null;

  const path = sparklinePath(points, {
    width: WIDTH,
    height: HEIGHT,
    paddingLeft: 28,
    paddingRight: 8,
    paddingTop: 10,
    paddingBottom: 22,
  });
  const y70 = sparklineBandY(70, { width: WIDTH, height: HEIGHT, paddingLeft: 28, paddingRight: 8, paddingTop: 10, paddingBottom: 22 });
  const y180 = sparklineBandY(180, { width: WIDTH, height: HEIGHT, paddingLeft: 28, paddingRight: 8, paddingTop: 10, paddingBottom: 22 });
  const plotLeft = 28;
  const plotRight = WIDTH - 8;
  const trend = sparklineTrend(points);
  const muted = isDark ? 'rgba(255,255,255,0.55)' : '#888';

  return (
    <View>
      <View style={styles.headerRow}>
        <Text style={[styles.subtitle, { color: muted }]}>Last 12 hours</Text>
        {trend && (
          <Text style={[styles.trend, { color }]}>
            {trend === 'up' ? '↑ Rising' : trend === 'down' ? '↓ Falling' : '→ Stable'}
          </Text>
        )}
      </View>
      <Svg width={WIDTH} height={HEIGHT}>
        <Line x1={plotLeft} y1={y70} x2={plotRight} y2={y70} stroke="rgba(129,199,132,0.35)" strokeWidth={1} />
        <Line x1={plotLeft} y1={y180} x2={plotRight} y2={y180} stroke="rgba(129,199,132,0.35)" strokeWidth={1} />
        <Path d={path} stroke={color} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
      <View style={[styles.axisRow, { paddingLeft: plotLeft, paddingRight: 8 }]}>
        <Text style={[styles.axis, { color: muted }]}>-12h</Text>
        <Text style={[styles.axis, { color: muted }]}>now</Text>
      </View>
      <Text style={[styles.hint, { color: muted }]}>
        Fixed scale {50}–{300} mg/dL · window {Math.round(SPARKLINE_WINDOW_MS / 3600000)}h
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  subtitle: { fontSize: 13, fontWeight: '600' },
  trend: { fontSize: 13, fontWeight: '700' },
  axisRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -18 },
  axis: { fontSize: 11 },
  hint: { fontSize: 11, marginTop: 4 },
});
