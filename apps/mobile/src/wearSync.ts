import { NativeModules, Platform } from 'react-native';
import type { BackgroundSettings, GlycemiaReading } from '@health-companion/shared';
import { SPARKLINE_WINDOW_MS } from '@health-companion/shared';

const { HealthCompanionWear } = NativeModules;

function historyPayload(history: GlycemiaReading[]) {
  const cutoff = Date.now() - SPARKLINE_WINDOW_MS;
  return history
    .filter((r) => r.timestamp >= cutoff)
    .map((r) => ({
      value: r.value,
      unit: r.unit,
      timestamp: r.timestamp,
    }));
}

export async function sendGlycemiaToWatch(
  reading: GlycemiaReading,
  history: GlycemiaReading[] = []
): Promise<boolean> {
  if (Platform.OS !== 'android' || !HealthCompanionWear) {
    return false;
  }
  try {
    await HealthCompanionWear.sendGlycemiaToWatch({
      value: reading.value,
      unit: reading.unit,
      timestamp: reading.timestamp,
      history: historyPayload(history),
    });
    return true;
  } catch {
    return false;
  }
}

export async function sendBackgroundToWatch(settings: BackgroundSettings): Promise<boolean> {
  if (Platform.OS !== 'android' || !HealthCompanionWear) {
    return false;
  }
  try {
    await HealthCompanionWear.sendBackgroundToWatch({
      type: settings.type,
      solidColor: settings.solidColor,
      gradientId: settings.gradientId,
      imageId: settings.imageId,
      imageIds: settings.imageIds,
      statusTint: settings.statusTint,
      textColor: settings.textColor,
      slideshowIntervalSec: settings.slideshowIntervalSec,
      faceStyle: settings.faceStyle,
      faceStyleUpdatedAt: settings.faceStyleUpdatedAt,
      customImageUris: settings.customImageUris,
      customImageUri: settings.customImageUri,
      updatedAt: settings.updatedAt,
    });
    return true;
  } catch {
    return false;
  }
}

