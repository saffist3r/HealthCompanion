import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useColorScheme,
} from 'react-native';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { File, Paths } from 'expo-file-system';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GeminiVoiceOrb, type VoiceOrbPhase } from '../components/GeminiVoiceOrb';
import { getAccessToken } from '../api/auth';
import { getApiBaseUrl } from '../api/config';
import { HC, themeColors } from '../theme';

/**
 * Clean turn-taking voice:
 *   idle → recording → sending → playing → (hands-free? recording : idle)
 * Mic is NEVER open while Reb3i is playing. No barge-in / duplex.
 */

type ChatLine = { id: string; role: 'user' | 'model' | 'system'; text: string };
type TalkMode = 'hold' | 'handsfree';
type Phase = 'idle' | 'recording' | 'sending' | 'playing';

const KEEP_AWAKE_TAG = 'reb3i-live';
/** Ignore breath / room noise — speech must clear this (dBFS). */
const SPEECH_DB = -28;
const SUSTAIN_MS = 350;
const SILENCE_MS = 550;
const MIN_SPEECH_MS = 450;
const MAX_UTTERANCE_MS = 25000;

/** Smaller/faster uploads than HIGH_QUALITY — Live only needs voice. */
const VOICE_OPTS = {
  ...RecordingPresets.LOW_QUALITY,
  isMeteringEnabled: true,
  numberOfChannels: 1,
  bitRate: 32000,
  sampleRate: 16000,
};

function meteringToLevel(m: number | undefined): number {
  if (typeof m !== 'number' || Number.isNaN(m)) return 0;
  return Math.max(0, Math.min(1, (m + 45) / 30));
}

function wsUrl(httpBase: string, token: string): string {
  const u = httpBase.replace(/\/$/, '');
  const ws = u.startsWith('https') ? u.replace(/^https/, 'wss') : u.replace(/^http/, 'ws');
  return `${ws}/ws/reb3i-live?token=${encodeURIComponent(token)}`;
}

export default function Reb3iLiveScreen() {
  const isDark = useColorScheme() === 'dark';
  const insets = useSafeAreaInsets();
  const t = styles(isDark);
  const recorder = useAudioRecorder(VOICE_OPTS);
  const recState = useAudioRecorderState(recorder, 100);
  const player = useAudioPlayer(null, { updateInterval: 50 });
  const playStatus = useAudioPlayerStatus(player);
  const playStatusRef = useRef(playStatus);
  useEffect(() => {
    playStatusRef.current = playStatus;
  }, [playStatus]);

  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [mode, setMode] = useState<TalkMode>('hold');
  const [handsFreeOn, setHandsFreeOn] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [hearing, setHearing] = useState(false);
  const [status, setStatus] = useState('Connecting…');
  const [contextSummary, setContextSummary] = useState<string | null>(null);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [draft, setDraft] = useState('');
  const idRef = useRef(0);

  const phaseRef = useRef<Phase>('idle');
  const handsFreeRef = useRef(false);
  const modeRef = useRef<TalkMode>('hold');
  const heardRef = useRef(false);
  const speechStartRef = useRef(0);
  const lastLoudRef = useRef(0);
  const loudSinceRef = useRef(0);
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPlayRef = useRef(false);
  const playQueueRef = useRef<string[]>([]);
  const drainingRef = useRef(false);
  const slicesDoneRef = useRef(false);
  const turnCompleteRef = useRef(false);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    handsFreeRef.current = handsFreeOn;
  }, [handsFreeOn]);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const voiceLevel = useMemo(() => {
    if (phase !== 'recording' || !recState.isRecording) return 0;
    return meteringToLevel(recState.metering);
  }, [phase, recState.isRecording, recState.metering]);

  const orbPhase: VoiceOrbPhase = useMemo(() => {
    if (!connected) return 'offline';
    if (!handsFreeOn) return 'idle';
    if (phase === 'playing') return 'speaking';
    if (phase === 'sending') return 'thinking';
    if (phase === 'recording' && hearing) return 'hearing';
    if (phase === 'recording') return 'listening';
    return 'idle';
  }, [connected, handsFreeOn, hearing, phase]);

  const pushLine = useCallback((role: ChatLine['role'], text: string) => {
    const clean = (text || '').trim();
    if (!clean) return;
    idRef.current += 1;
    setLines((prev) => [...prev, { id: `l${idRef.current}`, role, text: clean }]);
  }, []);

  const clearResume = () => {
    if (resumeTimerRef.current) {
      clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
    }
  };

  const sendJson = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      Alert.alert('Reb3i', 'Not connected.');
      return false;
    }
    ws.send(JSON.stringify(payload));
    return true;
  }, []);

  const stopRecorder = useCallback(async () => {
    try {
      if (recorder.isRecording) await recorder.stop();
    } catch {
      /* ignore */
    }
  }, [recorder]);

  const startRecorder = useCallback(async () => {
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Microphone', 'Allow mic access.');
      return false;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    try {
      player.pause();
    } catch {
      /* ignore */
    }
    await stopRecorder();
    await recorder.prepareToRecordAsync();
    recorder.record();
    return true;
  }, [player, recorder, stopRecorder]);

  const sendClip = useCallback(async () => {
    const uri = recorder.uri;
    if (!uri) {
      setPhase('idle');
      phaseRef.current = 'idle';
      setStatus('No audio captured');
      return;
    }
    setPhase('sending');
    phaseRef.current = 'sending';
    setHearing(false);
    setStatus('Sending…');
    try {
      const b64 = await new File(uri).base64();
      if (
        !sendJson({
          type: 'audio',
          data: b64,
          mimeType: 'audio/m4a',
          filename: uri.split('/').pop() || 'clip.m4a',
        })
      ) {
        setPhase('idle');
        phaseRef.current = 'idle';
      }
    } catch (e) {
      setPhase('idle');
      phaseRef.current = 'idle';
      setStatus(String(e));
      Alert.alert('Reb3i', String(e));
    }
  }, [recorder, sendJson]);

  const beginRecording = useCallback(async () => {
    if (phaseRef.current === 'recording' || phaseRef.current === 'sending') return;
    if (phaseRef.current === 'playing') {
      try {
        player.pause();
      } catch {
        /* ignore */
      }
    }
    const ok = await startRecorder();
    if (!ok) return;
    heardRef.current = false;
    speechStartRef.current = 0;
    lastLoudRef.current = 0;
    loudSinceRef.current = 0;
    setHearing(false);
    setPhase('recording');
    phaseRef.current = 'recording';
    setStatus(modeRef.current === 'handsfree' ? 'Listening… speak clearly' : 'Recording…');
  }, [player, startRecorder]);

  const endRecordingAndSend = useCallback(async () => {
    if (phaseRef.current !== 'recording') return;
    await stopRecorder();
    const longEnough =
      heardRef.current &&
      speechStartRef.current > 0 &&
      Date.now() - speechStartRef.current >= MIN_SPEECH_MS;
    // Hold mode: always send whatever was recorded (user controlled)
    if (modeRef.current === 'hold' || longEnough) {
      await sendClip();
      return;
    }
    // Hands-free false trigger — listen again
    setPhase('idle');
    phaseRef.current = 'idle';
    setHearing(false);
    if (handsFreeRef.current) {
      clearResume();
      resumeTimerRef.current = setTimeout(() => {
        resumeTimerRef.current = null;
        void beginRecording();
      }, 300);
    } else {
      setStatus('Ready');
    }
  }, [beginRecording, sendClip, stopRecorder]);

  const afterPlayMaybeResume = useCallback(() => {
    pendingPlayRef.current = false;
    slicesDoneRef.current = false;
    turnCompleteRef.current = false;
    playQueueRef.current = [];
    drainingRef.current = false;
    setPhase('idle');
    phaseRef.current = 'idle';
    if (handsFreeRef.current && modeRef.current === 'handsfree' && wsRef.current?.readyState === WebSocket.OPEN) {
      setStatus('Your turn — listening…');
      clearResume();
      resumeTimerRef.current = setTimeout(() => {
        resumeTimerRef.current = null;
        void beginRecording();
      }, 250);
    } else {
      setStatus('Your turn');
    }
  }, [beginRecording]);

  const drainPlayQueue = useCallback(async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    try {
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
      while (playQueueRef.current.length > 0) {
        const uri = playQueueRef.current.shift()!;
        setPhase('playing');
        phaseRef.current = 'playing';
        setStatus('Reb3i speaking…');
        pendingPlayRef.current = true;
        player.replace({ uri });
        player.play();
        // Wait until playback actually starts, then until it finishes
        // (old logic resolved after 180ms if not yet playing → chopped / silent gaps).
        const started = Date.now();
        await new Promise<void>((resolve) => {
          let sawPlaying = false;
          const tick = () => {
            const s = playStatusRef.current;
            if (s.playing) sawPlaying = true;
            if (sawPlaying && (s.didJustFinish || !s.playing)) {
              resolve();
              return;
            }
            if (
              sawPlaying &&
              s.duration > 0 &&
              s.currentTime >= Math.max(0, s.duration - 0.04)
            ) {
              resolve();
              return;
            }
            const elapsed = Date.now() - started;
            if (!sawPlaying && elapsed > 2500) {
              resolve();
              return;
            }
            if (elapsed > 10000) {
              resolve();
              return;
            }
            setTimeout(tick, 40);
          };
          setTimeout(tick, 30);
        });
      }
    } finally {
      drainingRef.current = false;
    }
    // Only resume mic after the turn is fully done and queue empty
    if (turnCompleteRef.current && playQueueRef.current.length === 0) {
      afterPlayMaybeResume();
    }
  }, [afterPlayMaybeResume, player]);

  const enqueueWavB64 = useCallback(
    async (b64: string) => {
      const file = new File(Paths.cache, `reb3i-s-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.wav`);
      if (file.exists) file.delete();
      file.create();
      file.write(b64, { encoding: 'base64' });
      playQueueRef.current.push(file.uri);
      setPhase('playing');
      phaseRef.current = 'playing';
      setStatus('Reb3i speaking…');
      pendingPlayRef.current = true;
      void drainPlayQueue();
    },
    [drainPlayQueue]
  );

  const connect = useCallback(async () => {
    setStatus('Connecting…');
    setConnected(false);
    try {
      const token = await getAccessToken();
      if (!token) {
        setStatus('Sign in required');
        Alert.alert('Reb3i', 'Sign in first.');
        return;
      }
      const base = await getApiBaseUrl();
      const prev = wsRef.current;
      if (prev) {
        try {
          prev.close();
        } catch {
          /* ignore */
        }
      }
      const ws = new WebSocket(wsUrl(base, token));
      wsRef.current = ws;
      ws.onopen = () => {
        setConnected(true);
        setStatus('Connected…');
      };
      ws.onclose = () => {
        setConnected(false);
        setHandsFreeOn(false);
        handsFreeRef.current = false;
        setPhase('idle');
        phaseRef.current = 'idle';
        setStatus('Disconnected');
      };
      ws.onerror = () => setStatus('Connection error');
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data));
          const type = msg.type as string;
          if (type === 'ready') {
            setContextSummary(msg.contextSummary || null);
            setStatus(msg.hint || 'Ready');
            pushLine('system', 'Session ready.');
          } else if (type === 'status') {
            setStatus(String(msg.message || ''));
          } else if (type === 'transcript') {
            pushLine(msg.role === 'user' ? 'user' : 'model', String(msg.text || ''));
          } else if ((type === 'audio_slice' || type === 'audio') && msg.data) {
            void enqueueWavB64(String(msg.data));
          } else if (type === 'turn_complete') {
            turnCompleteRef.current = true;
            // No audio at all → free UI; otherwise drainPlayQueue resumes when empty
            if (!pendingPlayRef.current && playQueueRef.current.length === 0 && !drainingRef.current) {
              afterPlayMaybeResume();
            } else if (!drainingRef.current && playQueueRef.current.length > 0) {
              void drainPlayQueue();
            } else if (!drainingRef.current && pendingPlayRef.current && playQueueRef.current.length === 0) {
              // Last slice already playing — drainPlayQueue will finish and resume
            }
          } else if (type === 'error') {
            setPhase('idle');
            phaseRef.current = 'idle';
            pendingPlayRef.current = false;
            playQueueRef.current = [];
            setStatus(String(msg.message || 'Error'));
            pushLine('system', String(msg.message || 'Error'));
            if (handsFreeRef.current) {
              clearResume();
              resumeTimerRef.current = setTimeout(() => void beginRecording(), 800);
            }
          }
        } catch {
          /* ignore */
        }
      };
    } catch (e) {
      setStatus(String(e));
    }
  }, [afterPlayMaybeResume, beginRecording, drainPlayQueue, enqueueWavB64, pushLine]);

  useEffect(() => {
    void connect();
    return () => {
      clearResume();
      void deactivateKeepAwake(KEEP_AWAKE_TAG);
      const ws = wsRef.current;
      if (ws) {
        try {
          ws.send(JSON.stringify({ type: 'end' }));
        } catch {
          /* ignore */
        }
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }
    };
  }, [connect]);

  // Hands-free VAD — only while recording, never while playing
  useEffect(() => {
    if (mode !== 'handsfree' || !handsFreeOn || phase !== 'recording' || !recState.isRecording) {
      return;
    }
    const level = recState.metering;
    if (typeof level !== 'number') return;
    const now = Date.now();

    if (level >= SPEECH_DB) {
      if (!loudSinceRef.current) loudSinceRef.current = now;
      if (now - loudSinceRef.current >= SUSTAIN_MS) {
        if (!heardRef.current) {
          heardRef.current = true;
          speechStartRef.current = now;
          setStatus('Hearing you…');
        }
        setHearing(true);
        lastLoudRef.current = now;
      }
    } else {
      loudSinceRef.current = 0;
      if (heardRef.current && now - lastLoudRef.current >= SILENCE_MS) {
        void endRecordingAndSend();
        return;
      }
      if (!heardRef.current) setHearing(false);
    }

    if (
      heardRef.current &&
      speechStartRef.current > 0 &&
      now - speechStartRef.current >= MAX_UTTERANCE_MS
    ) {
      void endRecordingAndSend();
    }
  }, [
    endRecordingAndSend,
    handsFreeOn,
    mode,
    phase,
    recState.durationMillis,
    recState.isRecording,
    recState.metering,
  ]);

  const stopHandsFree = async () => {
    setHandsFreeOn(false);
    handsFreeRef.current = false;
    clearResume();
    await stopRecorder();
    setHearing(false);
    setPhase('idle');
    phaseRef.current = 'idle';
    await deactivateKeepAwake(KEEP_AWAKE_TAG);
    setStatus('Hands-free off — tap orb to start');
  };

  const startHandsFree = async () => {
    if (!connected) {
      Alert.alert('Reb3i', 'Connect first.');
      return;
    }
    setMode('handsfree');
    modeRef.current = 'handsfree';
    setHandsFreeOn(true);
    handsFreeRef.current = true;
    await activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    pushLine('system', 'Hands-free on — speak, pause to send; mic off while Reb3i talks.');
    await beginRecording();
  };

  const onOrbPress = () => {
    if (!connected || phase === 'sending') return;
    if (handsFreeOn) void stopHandsFree();
    else void startHandsFree();
  };

  const selectHold = async () => {
    if (handsFreeOn) await stopHandsFree();
    setMode('hold');
    modeRef.current = 'hold';
  };

  const selectHandsFree = () => {
    setMode('handsfree');
    modeRef.current = 'handsfree';
    if (!handsFreeOn) setStatus('Hands-free — tap the orb to start');
  };

  const startHold = async () => {
    if (!connected || handsFreeOn || phase === 'sending' || phase === 'playing') return;
    setMode('hold');
    modeRef.current = 'hold';
    // Hold mode: treat any audio as intentional
    heardRef.current = true;
    speechStartRef.current = Date.now();
    await beginRecording();
  };

  const endHold = async () => {
    if (modeRef.current !== 'hold' || phaseRef.current !== 'recording') return;
    heardRef.current = true;
    await endRecordingAndSend();
  };

  const sendText = () => {
    const text = draft.trim();
    if (!text || phase === 'sending' || phase === 'recording' || handsFreeOn) return;
    pushLine('user', text);
    setDraft('');
    setPhase('sending');
    phaseRef.current = 'sending';
    setStatus('Reb3i is thinking…');
    if (!sendJson({ type: 'text', text })) {
      setPhase('idle');
      phaseRef.current = 'idle';
    }
  };

  return (
    <KeyboardAvoidingView
      style={[t.root, { paddingBottom: Math.max(insets.bottom, 12) }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={t.banner}>
        <Text style={t.bannerTitle}>Talk with Reb3i</Text>
        <Text style={t.status}>{status}</Text>
        {contextSummary ? (
          <Text style={t.ctx} numberOfLines={2}>
            {contextSummary}
          </Text>
        ) : null}
        {!connected ? (
          <TouchableOpacity style={t.reconnect} onPress={() => void connect()}>
            <Text style={t.reconnectText}>Reconnect</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={t.modeRow}>
        <TouchableOpacity
          style={[t.modeChip, mode === 'hold' && t.modeChipOn]}
          onPress={() => void selectHold()}
          disabled={!connected}
        >
          <Text style={[t.modeChipText, mode === 'hold' && t.modeChipTextOn]}>Hold to talk</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[t.modeChip, mode === 'handsfree' && t.modeChipDrive]}
          onPress={selectHandsFree}
          disabled={!connected}
        >
          <Text style={[t.modeChipText, mode === 'handsfree' && t.modeChipTextOn]}>Hands-free</Text>
        </TouchableOpacity>
      </View>

      {mode === 'handsfree' ? (
        <LinearGradient colors={['#0b1220', '#042f2e', '#1e1b4b']} style={t.orbPanel}>
          <GeminiVoiceOrb
            phase={orbPhase}
            level={voiceLevel}
            onPress={onOrbPress}
            disabled={!connected || phase === 'sending'}
            label={
              !handsFreeOn
                ? 'Tap to start'
                : phase === 'playing'
                  ? 'Reb3i speaking'
                  : phase === 'sending'
                    ? 'Sending…'
                    : hearing
                      ? 'Hearing you…'
                      : phase === 'recording'
                        ? 'Listening…'
                        : 'Hands-free'
            }
            sublabel={
              handsFreeOn
                ? 'Speak clearly · pause to send · mic off while he talks · tap to stop'
                : 'Simple turns: you talk → he replies → you talk'
            }
          />
        </LinearGradient>
      ) : null}

      <FlatList
        style={t.list}
        data={lines}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
        renderItem={({ item }) => (
          <View
            style={[
              t.bubble,
              item.role === 'user'
                ? t.bubbleUser
                : item.role === 'model'
                  ? t.bubbleModel
                  : t.bubbleSystem,
            ]}
          >
            <Text
              style={[
                t.bubbleText,
                item.role === 'user' && t.bubbleTextUser,
                item.role === 'system' && t.bubbleTextSystem,
              ]}
            >
              {item.text}
            </Text>
          </View>
        )}
      />

      {mode === 'hold' ? (
        <>
          <View style={t.composer}>
            <TextInput
              style={t.input}
              placeholder="Or type…"
              placeholderTextColor={isDark ? '#6e7681' : '#94a3b8'}
              value={draft}
              onChangeText={setDraft}
              editable={connected && phase === 'idle'}
              onSubmitEditing={sendText}
              returnKeyType="send"
            />
            <TouchableOpacity
              style={[t.sendBtn, (!draft.trim() || phase !== 'idle') && { opacity: 0.5 }]}
              onPress={sendText}
              disabled={!draft.trim() || !connected || phase !== 'idle'}
            >
              <Text style={t.sendText}>Send</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={[
              t.mic,
              phase === 'recording' && t.micOn,
              (!connected || phase === 'sending' || phase === 'playing') && { opacity: 0.5 },
            ]}
            onPressIn={() => void startHold()}
            onPressOut={() => void endHold()}
            disabled={!connected || phase === 'sending' || phase === 'playing'}
          >
            {phase === 'sending' || phase === 'playing' ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={t.micText}>
                {phase === 'recording' ? 'Release to send' : 'Hold to talk'}
              </Text>
            )}
          </TouchableOpacity>
        </>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = (isDark: boolean) => {
  const c = themeColors(isDark);
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    banner: {
      paddingHorizontal: 16,
      paddingTop: 8,
      paddingBottom: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    bannerTitle: { fontSize: 20, fontWeight: '800', color: c.ink },
    status: { marginTop: 6, color: HC.teal, fontWeight: '700', fontSize: 13 },
    ctx: { marginTop: 4, color: c.muted, fontSize: 11, lineHeight: 15 },
    reconnect: {
      marginTop: 8,
      alignSelf: 'flex-start',
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 10,
      backgroundColor: HC.teal,
    },
    reconnectText: { color: '#fff', fontWeight: '700' },
    modeRow: {
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: 16,
      paddingTop: 10,
      marginBottom: 8,
    },
    modeChip: {
      flex: 1,
      borderRadius: 12,
      paddingVertical: 10,
      alignItems: 'center',
      backgroundColor: isDark ? '#21262d' : '#e2e8f0',
      borderWidth: 1,
      borderColor: c.border,
    },
    modeChipOn: { backgroundColor: HC.teal, borderColor: HC.teal },
    modeChipDrive: { backgroundColor: HC.violet, borderColor: HC.violet },
    modeChipText: { color: c.ink, fontWeight: '700', fontSize: 13 },
    modeChipTextOn: { color: '#fff' },
    orbPanel: {
      marginHorizontal: 12,
      borderRadius: 24,
      paddingVertical: 12,
      marginBottom: 4,
    },
    list: { flex: 1 },
    bubble: {
      maxWidth: '88%',
      borderRadius: 14,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginBottom: 8,
    },
    bubbleUser: { alignSelf: 'flex-end', backgroundColor: HC.teal },
    bubbleModel: {
      alignSelf: 'flex-start',
      backgroundColor: isDark ? '#161b22' : '#fff',
      borderWidth: 1,
      borderColor: c.border,
    },
    bubbleSystem: {
      alignSelf: 'center',
      backgroundColor: isDark ? '#21262d' : '#eef2f7',
    },
    bubbleText: { color: c.ink, fontSize: 15, lineHeight: 21, writingDirection: 'auto' },
    bubbleTextUser: { color: '#fff' },
    bubbleTextSystem: { color: c.muted, fontSize: 12, textAlign: 'center' },
    composer: {
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: 16,
      paddingTop: 8,
      alignItems: 'center',
    },
    input: {
      flex: 1,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: isDark ? '#161b22' : '#fff',
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: Platform.OS === 'ios' ? 12 : 8,
      color: c.ink,
      fontSize: 15,
    },
    sendBtn: {
      backgroundColor: HC.teal,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    sendText: { color: '#fff', fontWeight: '800' },
    mic: {
      marginHorizontal: 16,
      marginTop: 10,
      backgroundColor: HC.violet,
      borderRadius: 16,
      paddingVertical: 18,
      alignItems: 'center',
    },
    micOn: { backgroundColor: '#be123c' },
    micText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  });
};
