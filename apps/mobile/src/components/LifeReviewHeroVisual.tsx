import { useEffect, useRef } from 'react';
import { Animated, Easing, View, StyleSheet } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Stop, Text as SvgText } from 'react-native-svg';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export default function LifeReviewHeroVisual({ active }: { active?: boolean }) {
  const ringOffset = useRef(new Animated.Value(740)).current;
  const coreScale = useRef(new Animated.Value(1)).current;
  const waveOpacity = useRef(new Animated.Value(0.3)).current;
  const nodeScales = useRef([...Array(7)].map(() => new Animated.Value(0))).current;

  useEffect(() => {
    Animated.timing(ringOffset, {
      toValue: 0,
      duration: 2000,
      delay: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();

    nodeScales.forEach((scale, i) => {
      Animated.spring(scale, {
        toValue: 1,
        delay: 400 + i * 120,
        friction: 6,
        tension: 80,
        useNativeDriver: true,
      }).start();
    });
  }, [nodeScales, ringOffset]);

  useEffect(() => {
    if (!active) return;
    const coreLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(coreScale, { toValue: 1.08, duration: 1400, useNativeDriver: true }),
        Animated.timing(coreScale, { toValue: 1, duration: 1400, useNativeDriver: true }),
      ])
    );
    const waveLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(waveOpacity, { toValue: 0.85, duration: 1200, useNativeDriver: true }),
        Animated.timing(waveOpacity, { toValue: 0.35, duration: 1200, useNativeDriver: true }),
      ])
    );
    coreLoop.start();
    waveLoop.start();
    return () => {
      coreLoop.stop();
      waveLoop.stop();
    };
  }, [active, coreScale, waveOpacity]);

  const nodes = [0, 1, 2, 3, 4, 5, 6].map((i) => {
    const angle = (i / 7) * Math.PI * 2 - Math.PI / 2;
    const x = 160 + Math.cos(angle) * 118;
    const y = 140 + Math.sin(angle) * 118;
    return { i, x, y, scale: nodeScales[i] };
  });

  return (
    <View style={styles.wrap}>
      <Svg width={280} height={240} viewBox="0 0 320 280">
        <Defs>
          <LinearGradient id="lrArcGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor="#5eead4" />
            <Stop offset="50%" stopColor="#a78bfa" />
            <Stop offset="100%" stopColor="#fcd34d" />
          </LinearGradient>
        </Defs>
        <Circle cx="160" cy="140" r="118" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
        <AnimatedCircle
          cx="160"
          cy="140"
          r="118"
          fill="none"
          stroke="url(#lrArcGrad)"
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray="740"
          strokeDashoffset={ringOffset}
        />
        <Path
          d="M 60 200 Q 100 170, 140 195 T 220 185 T 260 210"
          fill="none"
          stroke="rgba(94,234,212,0.55)"
          strokeWidth={2}
          strokeLinecap="round"
        />
      </Svg>

      {nodes.map(({ i, x, y, scale }) => (
        <Animated.View
          key={i}
          style={[
            styles.node,
            {
              left: (x / 320) * 280 - 10,
              top: (y / 280) * 240 - 10,
              transform: [{ scale }],
            },
          ]}
        >
          <View style={styles.nodeOuter} />
          <View style={styles.nodeInner} />
        </Animated.View>
      ))}

      <Animated.View
        style={[styles.core, { transform: [{ scale: coreScale }] }]}
      >
        <View style={styles.coreOuter} />
        <View style={styles.coreInner} />
        <Svg width={40} height={24} style={styles.coreLabel}>
          <SvgText x="20" y="17" textAnchor="middle" fill="#fff" fontSize="14" fontWeight="700">
            7d
          </SvgText>
        </Svg>
      </Animated.View>

      <Animated.View style={[styles.waveGlow, { opacity: waveOpacity }]} pointerEvents="none" />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: 280,
    height: 240,
    alignSelf: 'center',
    marginTop: 8,
  },
  node: {
    position: 'absolute',
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nodeOuter: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  nodeInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#fff',
    shadowColor: '#5eead4',
    shadowOpacity: 0.8,
    shadowRadius: 6,
    elevation: 4,
  },
  core: {
    position: 'absolute',
    left: 280 * 0.5 - 36,
    top: 240 * (140 / 280) - 36,
    width: 72,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coreOuter: {
    position: 'absolute',
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  coreInner: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(94,234,212,0.35)',
  },
  coreLabel: {
    position: 'absolute',
  },
  waveGlow: {
    position: 'absolute',
    bottom: 24,
    left: 40,
    right: 40,
    height: 2,
    borderRadius: 2,
    backgroundColor: 'rgba(94,234,212,0.5)',
  },
});
