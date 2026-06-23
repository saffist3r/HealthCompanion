/** Sparkline window on the watch face (12 hours). */
export const SPARKLINE_WINDOW_MS = 12 * 60 * 60 * 1000;

/** Fixed Y-axis for trend readability (mg/dL). */
export const SPARKLINE_Y_MIN_MG_DL = 50;
export const SPARKLINE_Y_MAX_MG_DL = 300;

/** Max readings kept for 12h history (~5 min CGM ≈ 144 points). */
export const MAX_GLYCEMIA_HISTORY = 150;

export const GLYCEMIA_HISTORY_DATA_PATH = '/health_companion/glycemia_history';

export interface SparklinePoint {
  valueMgDl: number;
  timestamp: number;
}
