import { useEffect, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { HC } from '../theme';

export type VoiceOrbPhase =
  | 'idle'
  | 'listening'
  | 'hearing'
  | 'thinking'
  | 'speaking'
  | 'offline';

type Props = {
  phase: VoiceOrbPhase;
  /** 0–1 live mic level (from metering). */
  level?: number;
  onPress?: () => void;
  disabled?: boolean;
  label?: string;
  sublabel?: string;
};

const BAR_COUNT = 12;

function phaseColors(phase: VoiceOrbPhase): [string, string, string] {
  switch (phase) {
    case 'hearing':
      return ['#a78bfa', '#7c3aed', '#4c1d95'];
    case 'listening':
      return ['#22D3EE', '#0891B2', '#134e4a'];
    case 'speaking':
      return ['#67e8f9', '#0891b2', '#164e63'];
    case 'thinking':
      return ['#c4b5fd', '#8b5cf6', '#4c1d95'];
    case 'offline':
      return ['#94a3b8', '#64748b', '#334155'];
    default:
      return ['#2dd4bf', '#0E7490', '#0A1A2E'];
  }
}

function phaseHint(phase: VoiceOrbPhase): string {
  switch (phase) {
    case 'hearing':
      return 'Hearing you…';
    case 'listening':
      return 'Listening — speak now';
    case 'speaking':
      return 'Reb3i is talking…';
    case 'thinking':
      return 'Sending…';
    case 'offline':
      return 'Not connected';
    default:
      return 'Tap to start hands-free';
  }
}

/**
 * Gemini-style orb. All Animated values use the JS driver only —
 * mixing native + JS drivers on the same view crashed the app when
 * mic metering spiked on speech.
 */
export function GeminiVoiceOrb({
  phase,
  level = 0,
  onPress,
  disabled,
  label,
  sublabel,
}: Props) {
  const breathe = useRef(new Animated.Value(1)).current;
  const ringOpacity = useRef(new Animated.Value(0.35)).current;
  const barAnims = useRef([...Array(BAR_COUNT)].map(() => new Animated.Value(0.2))).current;

  const colors = useMemo(() => phaseColors(phase), [phase]);
  const active = phase === 'listening' || phase === 'hearing' || phase === 'speaking';
  const clamped = Math.max(0, Math.min(1, level));

  // Rings grow with level via plain layout (no Animated transform mix)
  const ringOuter = 168 + clamped * 48;
  const ringMid = 148 + clamped * 28;

  useEffect(() => {
    barAnims.forEach((anim, i) => {
      const mid = BAR_COUNT / 2;
      const weight = 1 - Math.abs(i - mid) / mid;
      let target = 0.15;
      if (phase === 'hearing') {
        target = 0.28 + clamped * (0.5 + weight * 0.4);
      } else if (phase === 'listening') {
        target = 0.22 + weight * 0.12;
      } else if (phase === 'speaking') {
        target = 0.32 + weight * 0.3;
      }
      Animated.timing(anim, {
        toValue: Math.max(0.12, Math.min(1, target)),
        duration: phase === 'hearing' ? 70 : 200,
        useNativeDriver: false,
      }).start();
    });
  }, [barAnims, clamped, phase]);

  useEffect(() => {
    let breatheLoop: Animated.CompositeAnimation | null = null;
    let ringLoop: Animated.CompositeAnimation | null = null;
    if (active || phase === 'thinking') {
      breatheLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(breathe, {
            toValue: phase === 'hearing' ? 1.1 : 1.05,
            duration: phase === 'hearing' ? 380 : 900,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: false,
          }),
          Animated.timing(breathe, {
            toValue: 1,
            duration: phase === 'hearing' ? 380 : 900,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: false,
          }),
        ])
      );
      ringLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(ringOpacity, {
            toValue: 0.9,
            duration: 700,
            useNativeDriver: false,
          }),
          Animated.timing(ringOpacity, {
            toValue: 0.25,
            duration: 700,
            useNativeDriver: false,
          }),
        ])
      );
      breatheLoop.start();
      ringLoop.start();
    } else {
      breathe.setValue(1);
      ringOpacity.setValue(0.2);
    }
    return () => {
      breatheLoop?.stop();
      ringLoop?.stop();
    };
  }, [active, breathe, phase, ringOpacity]);

  return (
    <View style={styles.wrap}>
      <Text style={styles.phaseLabel}>{label || phaseHint(phase)}</Text>
      {sublabel ? <Text style={styles.sub}>{sublabel}</Text> : null}

      <TouchableOpacity
        activeOpacity={0.9}
        onPress={onPress}
        disabled={disabled || !onPress}
        accessibilityRole="button"
        accessibilityLabel={label || phaseHint(phase)}
        style={styles.hit}
      >
        <View style={styles.stage}>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.ring,
              {
                width: ringOuter,
                height: ringOuter,
                borderRadius: ringOuter / 2,
                borderColor: colors[0],
                opacity: ringOpacity,
              },
            ]}
          />
          <View
            pointerEvents="none"
            style={[
              styles.ring,
              {
                width: ringMid,
                height: ringMid,
                borderRadius: ringMid / 2,
                borderColor: colors[1],
                opacity: 0.45,
              },
            ]}
          />
          <Animated.View style={{ transform: [{ scale: breathe }] }}>
            <LinearGradient colors={colors} style={styles.core}>
              {phase === 'thinking' ? (
                <ActivityIndicator color="#fff" size="large" />
              ) : (
                <View style={styles.bars}>
                  {barAnims.map((anim, i) => (
                    <Animated.View
                      key={i}
                      style={[
                        styles.bar,
                        {
                          height: anim.interpolate({
                            inputRange: [0, 1],
                            outputRange: [8, 52],
                          }),
                          backgroundColor: '#fff',
                          opacity: phase === 'idle' ? 0.55 : 1,
                        },
                      ]}
                    />
                  ))}
                </View>
              )}
            </LinearGradient>
          </Animated.View>
        </View>
      </TouchableOpacity>

      <View style={styles.levelTrack}>
        <View
          style={[
            styles.levelFill,
            {
              width: `${Math.max(4, Math.round(clamped * 100))}%`,
              backgroundColor: phase === 'hearing' ? HC.violet : HC.tealBright,
            },
          ]}
        />
      </View>
      <Text style={styles.levelHint}>
        {phase === 'hearing'
          ? 'Voice detected'
          : phase === 'listening'
            ? 'Waiting for your voice'
            : phase === 'idle'
              ? 'Hands-free off — tap the orb to activate'
              : ' '}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: 8, paddingHorizontal: 16 },
  phaseLabel: {
    color: '#e2e8f0',
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 4,
  },
  sub: {
    color: 'rgba(226,232,240,0.7)',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 10,
    lineHeight: 18,
    maxWidth: 320,
  },
  hit: { alignItems: 'center', justifyContent: 'center' },
  stage: {
    width: 220,
    height: 220,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    borderWidth: 2,
  },
  core: {
    width: 132,
    height: 132,
    borderRadius: 66,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 10,
  },
  bars: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    height: 56,
  },
  bar: {
    width: 4,
    borderRadius: 3,
    minHeight: 8,
  },
  levelTrack: {
    marginTop: 14,
    width: 200,
    height: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
  },
  levelFill: {
    height: '100%',
    borderRadius: 999,
  },
  levelHint: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(226,232,240,0.75)',
    letterSpacing: 0.2,
  },
});
