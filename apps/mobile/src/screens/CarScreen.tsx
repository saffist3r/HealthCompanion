/**
 * Android Auto: a preview of the car screen (drawn by the same native code the car uses) and
 * how to make the app show up in the car.
 */
import { useCallback, useEffect, useState } from 'react';
import { DeviceEventEmitter, Image, NativeModules, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GLYCEMIA_UPDATED_EVENT } from '../glucoseCloudSync';
import { Button, HUD, Label, Panel, Pill, Screen, SectionHeader } from '../ui/hud';

type CarPreview = {
  uri: string;
  demo: boolean;
  rows: { title: string; text?: string | null }[];
  zoneColor: string;
};

const Native = NativeModules.HealthCompanionWear as { renderCarPreview?: () => Promise<CarPreview> } | undefined;

const STEPS = [
  'Open Android Auto settings on this phone.',
  'Tap Version about 10 times and accept developer mode.',
  'In the ⋮ menu, open Developer settings and tick Unknown sources.',
  'Reconnect to the car. HealthCompanion is in the car’s app launcher.',
];

export default function CarScreen() {
  const [preview, setPreview] = useState<CarPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!Native?.renderCarPreview) {
      setError('Needs the Android app.');
      return;
    }
    setBusy(true);
    try {
      setPreview(await Native.renderCarPreview());
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'Could not draw the preview.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load();
    const sub = DeviceEventEmitter.addListener(GLYCEMIA_UPDATED_EVENT, load);
    return () => sub.remove();
  }, [load]);

  return (
    <Screen padTop={false} refreshing={busy} onRefresh={load}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Label color={HUD.inkSoft}>Car screen preview</Label>
        {preview?.demo ? <Pill label="Sample data" color={HUD.amber} /> : <Pill label="Live" color={HUD.mint} />}
      </View>

      {/* Android Auto frame: app rail, title, rows on the left, the HUD panel on the right */}
      <View style={{ backgroundColor: '#000', borderRadius: 18, padding: 8, flexDirection: 'row', gap: 8, aspectRatio: 1.9 }}>
        <View style={{ width: 30, alignItems: 'center', justifyContent: 'space-around', paddingVertical: 6 }}>
          {(['navigate-outline', 'musical-notes-outline', 'call-outline', 'apps-outline'] as const).map((n, i) => (
            <Ionicons key={n} name={n} size={16} color={i === 3 ? HUD.ink : HUD.dim} />
          ))}
        </View>
        <View style={{ flex: 1, backgroundColor: '#1B1D22', borderRadius: 12, padding: 10, gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="arrow-back" size={14} color={HUD.muted} />
            <Text style={{ color: '#E8EAED', fontSize: 13 }}>HealthCompanion</Text>
          </View>
          <View style={{ flex: 1, flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1, justifyContent: 'center', gap: 2 }}>
              {(preview?.rows ?? []).map((r, i) => (
                <View
                  key={i}
                  style={{
                    flexDirection: 'row',
                    gap: 8,
                    paddingVertical: 6,
                    borderTopWidth: i ? 0.5 : 0,
                    borderTopColor: '#3C4043',
                  }}
                >
                  <View
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 5,
                      marginTop: 4,
                      backgroundColor: i === 0 ? preview?.zoneColor : 'transparent',
                    }}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: '#fff', fontSize: i === 0 ? 14 : 12 }} numberOfLines={1}>
                      {r.title}
                    </Text>
                    {r.text ? (
                      <Text style={{ color: '#9AA0A6', fontSize: 10 }} numberOfLines={1}>
                        {r.text}
                      </Text>
                    ) : null}
                  </View>
                </View>
              ))}
            </View>
            {preview ? (
              <Image
                source={{ uri: preview.uri }}
                style={{ width: '52%', aspectRatio: 4 / 3, alignSelf: 'center', borderRadius: 8 }}
                resizeMode="contain"
              />
            ) : null}
          </View>
        </View>
      </View>

      {preview ? (
        <Image
          source={{ uri: preview.uri }}
          style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: HUD.radius }}
          resizeMode="contain"
        />
      ) : null}
      {error ? <Text style={{ color: HUD.red }}>{error}</Text> : null}
      <Text style={{ color: HUD.muted, fontSize: 13, lineHeight: 19 }}>
        Android Auto draws the text on the left in its own style; the panel on the right is drawn by HealthCompanion.
        While the car is connected you also get alerts for a low, a low coming within 20 minutes, and a reading
        above 250 mg/dL.
      </Text>
      <Button label="Refresh preview" icon="refresh" variant="ghost" busy={busy} onPress={load} />

      <SectionHeader title="Show it in the car" />
      <Panel style={{ gap: 12 }}>
        {STEPS.map((step, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 12 }}>
            <Text style={{ color: HUD.cyan, fontFamily: HUD.fontCondensed, fontSize: 16, width: 16 }}>{i + 1}</Text>
            <Text style={{ color: HUD.ink, flex: 1, fontSize: 14, lineHeight: 20 }}>{step}</Text>
          </View>
        ))}
      </Panel>
    </Screen>
  );
}
