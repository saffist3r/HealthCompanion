/**
 * Shrink a meal photo before it's shown, analysed or uploaded.
 *
 * Phone cameras produce ~12 MP images (4000 × 3000, several MB). Decoding those for
 * thumbnails and uploading them made capture laggy, and Gemini reads a plate just as
 * well at 1600 px. Resizing runs natively, off the JS thread.
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

/** Long edge after resizing, in pixels. */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.72;

export async function preparePhoto(asset: { uri: string; width?: number; height?: number }): Promise<string> {
  const { uri, width = 0, height = 0 } = asset;
  try {
    const ctx = ImageManipulator.manipulate(uri);
    if (width && height && Math.max(width, height) > MAX_EDGE) {
      ctx.resize(width >= height ? { width: MAX_EDGE } : { height: MAX_EDGE });
    }
    // Unknown size (rare gallery providers): only re-encode, never enlarge
    const image = await ctx.renderAsync();
    const saved = await image.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG });
    return saved.uri;
  } catch {
    // Never block logging a meal on the resize: fall back to the original
    return uri;
  }
}
