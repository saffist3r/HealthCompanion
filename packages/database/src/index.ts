export type {
  GlycemiaReading,
  GlycemiaUnit,
  Macros,
  MealEntry,
  DailyReport,
  WeeklyReport,
  ActivitySnapshot,
} from '@health-companion/shared';

/** Settings stored on device / companion API (expand with SQLite later if needed). */
export interface AppSettings {
  glycemiaUnit: 'mmol/L' | 'mg/dL';
  notificationAccessEnabled: boolean;
  apiBaseUrl?: string;
  dailyCarbTargetG?: number;
}
