import { NativeModules, Platform } from 'react-native';
import type { GlycemiaReading } from '@health-companion/shared';

const { HealthCompanionWear } = NativeModules;

export async function sendGlycemiaToWatch(reading: GlycemiaReading): Promise<boolean> {
  if (Platform.OS !== 'android' || !HealthCompanionWear) {
    return false;
  }
  try {
    await HealthCompanionWear.sendGlycemiaToWatch({
      value: reading.value,
      unit: reading.unit,
      timestamp: reading.timestamp,
    });
    return true;
  } catch {
    return false;
  }
}
