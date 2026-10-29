import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Animated,
  ActivityIndicator,
  useColorScheme,
  Easing,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { LifeAssessment } from '@health-companion/shared';
import { generateLifeAssessment } from '../api/client';
import LifeReviewHeroVisual from '../components/LifeReviewHeroVisual';

const LOADING_LINES = [
  'Reading glucose patterns…',
  'Reviewing meals and macros…',
  'Checking steps and workouts…',
  'Looking at mood and stress…',
  'Connecting dots across days…',
  'Writing your honest assessment…',
];

function FadeIn({
  children,
  delay = 0,
  style,
}: {
  children: React.ReactNode;
  delay?: number;
  style?: object;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(18)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 520,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 520,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [delay, opacity, translateY]);

  return (
    <Animated.View style={[style, { opacity, transform: [{ translateY }] }]}>
      {children}
    </Animated.View>
  );
}

function StatCard({
  label,
  value,
  cardBg,
  border,
  ink,
  muted,
  delay,
}: {
  label: string;
  value: string;
  cardBg: string;
  border: string;
  ink: string;
  muted: string;
  delay: number;
}) {
  const display = useRef(new Animated.Value(0)).current;
  const numeric = parseFloat(String(value).replace(/[^0-9.]/g, '')) || 0;
  const suffix = String(value).replace(/^[\d,.]+/, '');

  useEffect(() => {
    display.setValue(0);
    Animated.timing(display, {
      toValue: numeric,
      duration: 900,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [numeric, delay, display]);

  const [shown, setShown] = useState('0');
  useEffect(() => {
    const id = display.addListener(({ value: v }) => {
      setShown(`${Math.round(v).toLocaleString()}${suffix}`);
    });
    return () => display.removeListener(id);
  }, [display, suffix]);

  return (
    <FadeIn delay={delay} style={{ flex: 1, minWidth: 90 }}>
      <View style={[statStyles.card, { backgroundColor: cardBg, borderColor: border }]}>
        <Text style={[statStyles.label, { color: muted }]}>{label}</Text>
        <Text style={[statStyles.value, { color: ink }]}>{shown}</Text>
      </View>
    </FadeIn>
  );
}

const statStyles = StyleSheet.create({
  card: { borderRadius: 16, padding: 14, borderWidth: 1 },
  label: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  value: { fontSize: 22, fontWeight: '800', marginTop: 4 },
});

export default function LifeReviewScreen() {
  const isDark = useColorScheme() === 'dark';
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [assessment, setAssessment] = useState<LifeAssessment | null>(null);
  const pulse = useRef(new Animated.Value(1)).current;
  const eyebrowPulse = useRef(new Animated.Value(0.4)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const t = styles(isDark);

  useEffect(() => {
    if (!busy) return;
    progressAnim.setValue(0);
    const stepTimer = setInterval(() => setStep((s) => (s + 1) % LOADING_LINES.length), 2200);
    const progTimer = setInterval(() => {
      progressAnim.stopAnimation((current) => {
        const next = Math.min((current || 0) + 4 + Math.random() * 6, 92);
        Animated.timing(progressAnim, {
          toValue: next,
          duration: 350,
          useNativeDriver: false,
        }).start();
      });
    }, 400);
    return () => {
      clearInterval(stepTimer);
      clearInterval(progTimer);
    };
  }, [busy, progressAnim]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(eyebrowPulse, { toValue: 1, duration: 1000, useNativeDriver: true }),
        Animated.timing(eyebrowPulse, { toValue: 0.4, duration: 1000, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [eyebrowPulse]);

  useEffect(() => {
    if (!busy) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.02, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [busy, pulse]);

  const run = async () => {
    setBusy(true);
    setStep(0);
    try {
      const result = await generateLifeAssessment(7);
      Animated.timing(progressAnim, { toValue: 100, duration: 300, useNativeDriver: false }).start();
      await new Promise((r) => setTimeout(r, 350));
      setAssessment(result);
    } catch (e) {
      Alert.alert('Life review', String(e));
    } finally {
      setBusy(false);
    }
  };

  const totals = assessment?.totals as Record<string, unknown> | undefined;
  const cardBg = isDark ? '#0E1624' : '#fff';
  const border = isDark ? '#1E3350' : '#e2e8f0';
  const ink = isDark ? '#E6F4FF' : '#0f172a';
  const muted = isDark ? '#8CA0BC' : '#64748b';

  const stats = useMemo(() => {
    if (!totals) return [];
    const items: Array<{ label: string; value: string }> = [];
    if (totals.avgTimeInRangePct != null) {
      items.push({ label: 'Avg TIR', value: `${totals.avgTimeInRangePct}%` });
    }
    if (totals.totalSteps != null) {
      items.push({ label: 'Steps', value: Number(totals.totalSteps).toLocaleString() });
    }
    if (totals.mealCount != null) {
      items.push({ label: 'Meals', value: String(totals.mealCount) });
    }
    if (totals.workoutCount != null) {
      items.push({ label: 'Workouts', value: String(totals.workoutCount) });
    }
    return items;
  }, [totals]);

  const dataPills = ['Glucose', 'Meals', 'Steps', 'Mood', 'Stress', 'Sport'];
  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
  });

  return (
    <ScrollView style={t.root} contentContainerStyle={t.content}>
      <LinearGradient
        colors={['#070B14', '#0E7490', '#1B1440']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={t.hero}
      >
        <View style={t.heroMesh} pointerEvents="none" />
        <View style={t.eyebrowRow}>
          <Animated.View style={[t.eyebrowDot, { opacity: eyebrowPulse }]} />
          <Text style={t.eyebrow}>7-DAY HONEST READ</Text>
        </View>
        <Text style={t.heroTitle}>How was your week, really?</Text>
        <Text style={t.heroSub}>
          Glucose, food, movement, mood, stress & sport — one unfiltered narrative from what you logged.
        </Text>
        <View style={t.pillRow}>
          {dataPills.map((p) => (
            <View key={p} style={t.pill}>
              <Text style={t.pillText}>{p}</Text>
            </View>
          ))}
        </View>
        <LifeReviewHeroVisual active={busy || !!assessment} />
        <TouchableOpacity style={t.cta} onPress={run} disabled={busy} activeOpacity={0.88}>
          {busy ? (
            <View style={t.ctaBusyRow}>
              <ActivityIndicator color="#0A1A2E" size="small" />
              <Text style={t.ctaText}>Analyzing your week…</Text>
            </View>
          ) : (
            <Text style={t.ctaText}>{assessment ? 'Regenerate review' : 'Generate my review'}</Text>
          )}
        </TouchableOpacity>
      </LinearGradient>

      {busy ? (
        <Animated.View style={[t.loadingBox, { transform: [{ scale: pulse }] }]}>
          <View style={t.loadingSteps}>
            {LOADING_LINES.map((_, i) => (
              <View
                key={i}
                style={[
                  t.loadingStep,
                  i < step && t.loadingStepDone,
                  i === step && t.loadingStepCurrent,
                ]}
              />
            ))}
          </View>
          <View style={t.progressTrack}>
            <Animated.View style={[t.progressFill, { width: progressWidth }]} />
          </View>
          <Text style={t.loadingText}>{LOADING_LINES[step]}</Text>
          <Text style={t.loadingHint}>
            Pulling meals, CGM, steps, check-ins, and sport into one narrative.
          </Text>
        </Animated.View>
      ) : null}

      {!busy && assessment ? (
        <View style={t.results} key={assessment.generatedAt || assessment.periodEnd}>
          <FadeIn>
            <Text style={t.period}>
              {assessment.periodStart} → {assessment.periodEnd}
            </Text>
            <Text style={t.headline}>{assessment.headline}</Text>
          </FadeIn>

          {stats.length > 0 ? (
            <View style={t.statRow}>
              {stats.map((s, i) => (
                <StatCard
                  key={s.label}
                  label={s.label}
                  value={s.value}
                  cardBg={cardBg}
                  border={border}
                  ink={ink}
                  muted={muted}
                  delay={80 + i * 60}
                />
              ))}
            </View>
          ) : null}

          <FadeIn delay={140}>
            <LinearGradient
              colors={isDark ? ['#0E1624', '#0f172a'] : ['#fff', '#f0fdfa']}
              style={[t.summaryCard, { borderColor: border }]}
            >
              <Text style={[t.summary, { color: ink }]}>{assessment.honestSummary}</Text>
            </LinearGradient>
          </FadeIn>

          {(assessment.glucoseVerdict ||
            assessment.lifestyleVerdict ||
            assessment.moodVerdict) && (
            <FadeIn delay={180}>
              <View style={t.verdictRow}>
                {assessment.glucoseVerdict ? (
                  <View style={[t.verdict, t.verdictGlucose, { backgroundColor: cardBg, borderColor: border }]}>
                    <Text style={t.verdictIcon}>💧</Text>
                    <Text style={[t.verdictTitle, { color: ink }]}>Glucose</Text>
                    <Text style={[t.verdictBody, { color: muted }]}>{assessment.glucoseVerdict}</Text>
                  </View>
                ) : null}
                {assessment.lifestyleVerdict ? (
                  <View style={[t.verdict, t.verdictLife, { backgroundColor: cardBg, borderColor: border }]}>
                    <Text style={t.verdictIcon}>👟</Text>
                    <Text style={[t.verdictTitle, { color: ink }]}>Lifestyle</Text>
                    <Text style={[t.verdictBody, { color: muted }]}>{assessment.lifestyleVerdict}</Text>
                  </View>
                ) : null}
                {assessment.moodVerdict ? (
                  <View style={[t.verdict, t.verdictMood, { backgroundColor: cardBg, borderColor: border }]}>
                    <Text style={t.verdictIcon}>✨</Text>
                    <Text style={[t.verdictTitle, { color: ink }]}>Mood</Text>
                    <Text style={[t.verdictBody, { color: muted }]}>{assessment.moodVerdict}</Text>
                  </View>
                ) : null}
              </View>
            </FadeIn>
          )}

          {(assessment.wins.length > 0 || assessment.concerns.length > 0) && (
            <FadeIn delay={220}>
              <View style={t.splitRow}>
                {assessment.wins.length > 0 ? (
                  <View style={[t.splitCard, t.winCard, { backgroundColor: cardBg, borderColor: border }]}>
                    <Text style={t.splitTitle}>Wins</Text>
                    {assessment.wins.map((w, i) => (
                      <Text key={i} style={t.winLine}>
                        ✓ {w}
                      </Text>
                    ))}
                  </View>
                ) : null}
                {assessment.concerns.length > 0 ? (
                  <View style={[t.splitCard, t.concernCard, { backgroundColor: cardBg, borderColor: border }]}>
                    <Text style={t.splitTitle}>Concerns</Text>
                    {assessment.concerns.map((c, i) => (
                      <Text key={i} style={t.concernLine}>
                        ! {c}
                      </Text>
                    ))}
                  </View>
                ) : null}
              </View>
            </FadeIn>
          )}

          {assessment.patterns.length > 0 ? (
            <FadeIn delay={260}>
              <View style={[t.sectionCard, { backgroundColor: cardBg, borderColor: border }]}>
                <Text style={[t.sectionTitle, { color: ink }]}>Patterns</Text>
                <Text style={[t.sectionSub, { color: muted }]}>What kept showing up across the week</Text>
                {assessment.patterns.map((p, i) => (
                  <Text key={i} style={[t.patternLine, { color: ink }]}>
                    • {p}
                  </Text>
                ))}
              </View>
            </FadeIn>
          ) : null}

          {assessment.priorities.length > 0 ? (
            <FadeIn delay={300}>
              <View style={[t.sectionCard, { backgroundColor: cardBg, borderColor: border }]}>
                <Text style={[t.sectionTitle, { color: ink }]}>Focus next week</Text>
                <Text style={[t.sectionSub, { color: muted }]}>Where to put energy next week</Text>
                {assessment.priorities.map((p, i) => (
                  <View key={i} style={t.priorityRow}>
                    <View style={t.priorityNum}>
                      <Text style={t.priorityNumText}>{i + 1}</Text>
                    </View>
                    <Text style={[t.priorityText, { color: ink }]}>{p}</Text>
                  </View>
                ))}
              </View>
            </FadeIn>
          ) : null}

          <Text style={[t.disclaimer, { color: muted }]}>
            Lifestyle coaching only — not medical advice. Talk to your care team about insulin or treatment
            changes.
          </Text>
        </View>
      ) : !busy ? (
        <View style={t.emptyWrap}>
          <Text style={t.emptyIcon}>✦</Text>
          <Text style={[t.empty, { color: muted }]}>
            Hit the button above when you are ready for an honest read.
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

function styles(isDark: boolean) {
  const bg = isDark ? '#070B14' : '#f3f7f6';
  const card = isDark ? '#0E1624' : '#fff';
  const ink = isDark ? '#E6F4FF' : '#0f172a';
  const muted = isDark ? '#8CA0BC' : '#64748b';
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: bg },
    content: { paddingBottom: 48 },
    hero: {
      padding: 24,
      paddingTop: 12,
      borderBottomLeftRadius: 28,
      borderBottomRightRadius: 28,
      overflow: 'hidden',
    },
    heroMesh: {
      ...StyleSheet.absoluteFillObject,
      opacity: 0.45,
      backgroundColor: 'transparent',
    },
    eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
    eyebrowDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: '#22D3EE',
    },
    eyebrow: {
      color: 'rgba(255,255,255,0.72)',
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 1.4,
    },
    heroTitle: {
      color: '#fff',
      fontSize: 30,
      fontWeight: '700',
      lineHeight: 36,
      marginBottom: 10,
      letterSpacing: -0.5,
    },
    heroSub: { color: 'rgba(255,255,255,0.85)', fontSize: 15, lineHeight: 22, marginBottom: 14 },
    pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
    pill: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: 'rgba(255,255,255,0.1)',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.16)',
    },
    pillText: { color: '#fff', fontSize: 11, fontWeight: '700' },
    cta: {
      backgroundColor: '#fff',
      borderRadius: 16,
      paddingVertical: 16,
      alignItems: 'center',
      marginTop: 16,
      shadowColor: '#000',
      shadowOpacity: 0.2,
      shadowRadius: 12,
      elevation: 4,
    },
    ctaBusyRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    ctaText: { color: '#0A1A2E', fontSize: 16, fontWeight: '800' },
    loadingBox: {
      margin: 20,
      padding: 28,
      borderRadius: 24,
      backgroundColor: card,
      borderWidth: 1,
      borderColor: isDark ? '#1E3350' : '#e2e8f0',
    },
    loadingSteps: { flexDirection: 'row', gap: 4, marginBottom: 16 },
    loadingStep: {
      flex: 1,
      height: 4,
      borderRadius: 4,
      backgroundColor: isDark ? '#1E3350' : '#e2e8f0',
    },
    loadingStepDone: { backgroundColor: '#0891B2' },
    loadingStepCurrent: { backgroundColor: '#7c3aed', transform: [{ scaleY: 1.4 }] },
    progressTrack: {
      height: 6,
      borderRadius: 999,
      backgroundColor: isDark ? '#16233A' : '#e2e8f0',
      overflow: 'hidden',
      marginBottom: 18,
    },
    progressFill: {
      height: '100%',
      borderRadius: 999,
      backgroundColor: '#0891B2',
    },
    loadingText: { color: ink, fontSize: 15, fontWeight: '700', textAlign: 'center', marginBottom: 8 },
    loadingHint: { color: muted, fontSize: 13, textAlign: 'center', lineHeight: 19 },
    results: { padding: 20, gap: 4 },
    period: { color: '#0891B2', fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
    headline: { color: ink, fontSize: 26, fontWeight: '800', marginTop: 6, marginBottom: 14, lineHeight: 32 },
    statRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 8 },
    summaryCard: {
      borderRadius: 20,
      padding: 18,
      borderWidth: 1,
      marginVertical: 8,
    },
    summary: { fontSize: 15, lineHeight: 24 },
    verdictRow: { gap: 12, marginVertical: 8 },
    verdict: {
      borderRadius: 18,
      padding: 16,
      borderWidth: 1,
      borderLeftWidth: 4,
    },
    verdictGlucose: { borderLeftColor: '#0891B2' },
    verdictLife: { borderLeftColor: '#7c3aed' },
    verdictMood: { borderLeftColor: '#d97706' },
    verdictIcon: { fontSize: 22, marginBottom: 6 },
    verdictTitle: { fontSize: 13, fontWeight: '800', textTransform: 'uppercase', marginBottom: 6 },
    verdictBody: { fontSize: 14, lineHeight: 21 },
    splitRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginVertical: 8 },
    splitCard: {
      flex: 1,
      minWidth: 150,
      borderRadius: 18,
      padding: 16,
      borderWidth: 1,
    },
    winCard: { borderTopWidth: 3, borderTopColor: '#059669' },
    concernCard: { borderTopWidth: 3, borderTopColor: '#d97706' },
    splitTitle: { color: ink, fontSize: 13, fontWeight: '800', textTransform: 'uppercase', marginBottom: 10 },
    winLine: { color: '#059669', fontSize: 14, lineHeight: 22, marginBottom: 4 },
    concernLine: { color: '#d97706', fontSize: 14, lineHeight: 22, marginBottom: 4 },
    sectionCard: {
      borderRadius: 18,
      padding: 16,
      borderWidth: 1,
      marginVertical: 8,
    },
    sectionTitle: { fontSize: 16, fontWeight: '800', marginBottom: 4 },
    sectionSub: { fontSize: 13, marginBottom: 12 },
    patternLine: { fontSize: 14, lineHeight: 22, marginBottom: 6 },
    priorityRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginBottom: 12 },
    priorityNum: {
      width: 30,
      height: 30,
      borderRadius: 10,
      backgroundColor: isDark ? '#0B2E3A' : '#ccfbf1',
      alignItems: 'center',
      justifyContent: 'center',
    },
    priorityNumText: { color: '#0891B2', fontWeight: '800', fontSize: 14 },
    priorityText: { flex: 1, fontSize: 14, lineHeight: 21 },
    disclaimer: { fontSize: 12, textAlign: 'center', marginTop: 24, lineHeight: 18 },
    emptyWrap: { alignItems: 'center', padding: 40, gap: 12 },
    emptyIcon: { fontSize: 32, color: '#0891B2', opacity: 0.6 },
    empty: { textAlign: 'center', fontSize: 14, lineHeight: 21, maxWidth: 280 },
  });
}
