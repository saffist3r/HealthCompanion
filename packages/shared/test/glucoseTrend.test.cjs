// Same cases as the watch's GlucoseTrendEngineTest.kt, so phone, web and watch agree.
// Runs against the compiled package: `npm test -w @health-companion/shared`.
const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeGlucose, sanitizeGlucose, glucoseZone, EMPTY_GLUCOSE_INSIGHT } = require('../dist/glucoseTrend.js');

const now = 1_800_000_000_000;
const min = 60_000;

/** Readings every stepMin minutes ending endAgoMin minutes before now, values oldest → newest. */
function series(values, { stepMin = 5, endAgoMin = 1 } = {}) {
  return values.map((v, i) => ({ mgDl: v, timestamp: now - (endAgoMin + (values.length - 1 - i) * stepMin) * min }));
}

const isRising = (a) => a === 'doubleUp' || a === 'singleUp' || a === 'fortyFiveUp';

test('steady readings are flat', () => {
  const insight = analyzeGlucose(series([120, 121, 119, 120, 121]), now);
  assert.equal(insight.arrow, 'flat');
  assert.equal(insight.zone, 'inRange');
  assert.equal(insight.minutesToLow, null);
});

test('slow drift over two hours is not a trend', () => {
  // Old detector: +9 mg/dL between first and last point ⇒ "rising". It's ~0.1 mg/dL/min.
  const insight = analyzeGlucose(series([110, 112, 115, 117, 119], { stepMin: 25 }), now);
  assert.ok(insight.arrow === 'flat' || insight.arrow === 'none', insight.arrow);
});

test('rate bands match CGM arrows', () => {
  assert.equal(analyzeGlucose(series([100, 107, 114, 121]), now).arrow, 'fortyFiveUp');
  assert.equal(analyzeGlucose(series([100, 112, 124, 136]), now).arrow, 'singleUp');
  assert.equal(analyzeGlucose(series([100, 117, 134, 151]), now).arrow, 'doubleUp');
  assert.equal(analyzeGlucose(series([160, 153, 146, 139]), now).arrow, 'fortyFiveDown');
  assert.equal(analyzeGlucose(series([160, 148, 136, 124]), now).arrow, 'singleDown');
  assert.equal(analyzeGlucose(series([180, 162, 144, 126]), now).arrow, 'doubleDown');
});

test('recent turnaround wins over older trend', () => {
  // Was falling for 15 min, now clearly rising for the last 10 min.
  const insight = analyzeGlucose(series([150, 140, 130, 122, 118, 120, 126, 133], { stepMin: 2 }), now);
  assert.ok(isRising(insight.arrow), `expected rising, got ${insight.arrow} (${insight.ratePerMin})`);
});

test('single noisy spike does not flip the trend', () => {
  const insight = analyzeGlucose(series([120, 121, 120, 132, 121, 120], { stepMin: 3 }), now);
  assert.equal(insight.arrow, 'flat');
});

test('one-minute sensor jitter stays flat', () => {
  // Libre-style 1-minute readings around 120 with ±4 mg/dL noise: arrow must not flicker.
  const noise = [0, 3, -2, 4, -4, 1, -3, 2, -1, 4, -2, 0, 3, -4, 2];
  const all = noise.map((n, i) => ({ mgDl: 120 + n, timestamp: now - (noise.length - i) * min }));
  for (let end = 6; end <= all.length; end++) {
    const window = all.slice(0, end);
    const at = window[window.length - 1].timestamp + min;
    assert.equal(analyzeGlucose(window, at).arrow, 'flat', `window ending ${end}`);
  }
});

test('one-minute steady fall is caught', () => {
  const all = Array.from({ length: 12 }, (_, i) => ({
    mgDl: 140 - i * 2.2 + (i % 2 === 0 ? 2 : -2),
    timestamp: now - (12 - i) * min,
  }));
  assert.equal(analyzeGlucose(all, now).arrow, 'singleDown');
});

test('stale data has no trend or forecast', () => {
  const insight = analyzeGlucose(series([100, 110, 120, 130], { endAgoMin: 25 }), now);
  assert.equal(insight.isStale, true);
  assert.equal(insight.arrow, 'none');
  assert.equal(insight.prediction.length, 0);
});

test('too few or too close readings have no trend', () => {
  assert.equal(analyzeGlucose(series([120]), now).arrow, 'none');
  assert.equal(analyzeGlucose(series([120, 140], { stepMin: 1 }), now).arrow, 'none');
  assert.deepEqual(analyzeGlucose([], now), EMPTY_GLUCOSE_INSIGHT);
});

test('re-posted duplicates are merged', () => {
  const base = series([120, 125, 130]);
  const dupes = [...base, ...base.map((s) => ({ ...s, timestamp: s.timestamp + 10_000 }))];
  assert.equal(sanitizeGlucose(dupes).length, 3);
});

test('predicts low before it happens', () => {
  // 100 mg/dL falling ~2.4 mg/dL/min → under 70 in roughly 15 min.
  const insight = analyzeGlucose(series([136, 124, 112, 100]), now);
  assert.notEqual(insight.minutesToLow, null);
  assert.ok(insight.minutesToLow >= 10 && insight.minutesToLow <= 20, `minutesToLow=${insight.minutesToLow}`);
  assert.ok(insight.predicted20Min < 70);
  assert.equal(insight.minutesToHigh, null);
});

test('forecast is damped, not linear', () => {
  const insight = analyzeGlucose(series([100, 110, 120, 130]), now);
  const linear30 = 130 + insight.ratePerMin * 30;
  const damped30 = insight.prediction[insight.prediction.length - 1].mgDl;
  assert.ok(damped30 > 130 && damped30 < linear30);
  assert.equal(insight.prediction.length, 6);
});

test('predicts high when rising towards the ceiling', () => {
  const insight = analyzeGlucose(series([130, 142, 154, 166]), now);
  assert.notEqual(insight.minutesToHigh, null);
  assert.equal(insight.minutesToLow, null);
});

test('zones and time in range', () => {
  assert.equal(glucoseZone(50), 'urgentLow');
  assert.equal(glucoseZone(65), 'low');
  assert.equal(glucoseZone(200), 'high');
  assert.equal(glucoseZone(260), 'veryHigh');
  assert.equal(analyzeGlucose(series([60, 100, 150, 200]), now).timeInRangePct, 50);
});
