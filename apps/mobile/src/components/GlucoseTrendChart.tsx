import { useState } from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import type { GlucoseSample } from '@health-companion/shared';
import { HUD, withAlpha } from '../ui/hud';

const Y_MIN = 40;
const Y_MAX = 300;

/** Glucose over the last `hours`, target band, and the 30-minute forecast — the watch HUD's chart. */
export default function GlucoseTrendChart({
  samples,
  prediction,
  nowMs,
  hours = 12,
  height = 120,
  low = 70,
  high = 180,
}: {
  samples: GlucoseSample[];
  prediction: GlucoseSample[];
  nowMs: number;
  hours?: number;
  height?: number;
  low?: number;
  high?: number;
}) {
  const [width, setWidth] = useState(0);
  const futureMs = prediction.length ? prediction[prediction.length - 1].timestamp - nowMs : 0;
  const start = nowMs - hours * 3_600_000;
  const end = nowMs + Math.max(futureMs, 30 * 60_000);
  const x = (ts: number) => ((ts - start) / (end - start)) * width;
  const y = (mg: number) => height - ((Math.min(Math.max(mg, Y_MIN), Y_MAX) - Y_MIN) / (Y_MAX - Y_MIN)) * height;

  const points = samples.filter((p) => p.timestamp >= start && p.timestamp <= nowMs).sort((a, b) => a.timestamp - b.timestamp);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.timestamp).toFixed(1)},${y(p.mgDl).toFixed(1)}`).join(' ');
  const area = points.length > 1 ? `${line} L${x(points[points.length - 1].timestamp).toFixed(1)},${height} L${x(points[0].timestamp).toFixed(1)},${height} Z` : '';
  const last = points[points.length - 1];
  const forecast =
    last && prediction.length
      ? [last, ...prediction].map((p, i) => `${i ? 'L' : 'M'}${x(p.timestamp).toFixed(1)},${y(p.mgDl).toFixed(1)}`).join(' ')
      : '';

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 ? (
        <Svg width={width} height={height}>
          <Defs>
            <LinearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={HUD.cyan} stopOpacity={0.28} />
              <Stop offset="1" stopColor={HUD.cyan} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={y(high)} width={width} height={y(low) - y(high)} fill={withAlpha(HUD.mint, 0.07)} />
          <Line x1={0} x2={width} y1={y(high)} y2={y(high)} stroke={withAlpha(HUD.mint, 0.35)} strokeDasharray="3 5" />
          <Line x1={0} x2={width} y1={y(low)} y2={y(low)} stroke={withAlpha(HUD.red, 0.4)} strokeDasharray="3 5" />
          <Line x1={x(nowMs)} x2={x(nowMs)} y1={0} y2={height} stroke={HUD.line} />
          {area ? <Path d={area} fill="url(#fill)" /> : null}
          {line ? <Path d={line} stroke={HUD.cyan} strokeWidth={2.2} fill="none" strokeLinejoin="round" strokeLinecap="round" /> : null}
          {forecast ? <Path d={forecast} stroke={HUD.violet} strokeWidth={2} strokeDasharray="4 4" fill="none" /> : null}
          {last ? (
            <>
              <Circle cx={x(last.timestamp)} cy={y(last.mgDl)} r={9} fill={withAlpha(HUD.cyan, 0.2)} />
              <Circle cx={x(last.timestamp)} cy={y(last.mgDl)} r={4} fill="#fff" />
            </>
          ) : null}
        </Svg>
      ) : (
        <View style={{ height }} />
      )}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
        <Text style={axis}>−{hours}H</Text>
        <Text style={axis}>
          NOW <Text style={{ color: HUD.violet }}>· +30M</Text>
        </Text>
      </View>
    </View>
  );
}

const axis = { color: HUD.dim, fontFamily: HUD.fontCondensed, fontSize: 11, letterSpacing: 1.2 } as const;
