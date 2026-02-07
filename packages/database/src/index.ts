export type { GlycemiaReading, GlycemiaUnit } from '@health-companion/shared';

/** Settings stored on device (future: SQLite/WatermelonDB) */
export interface AppSettings {
  glycemiaUnit: 'mmol/L' | 'mg/dL';
  notificationAccessEnabled: boolean;
}
