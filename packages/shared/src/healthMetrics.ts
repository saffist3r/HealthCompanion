/** Activity / sport samples synced from Health Connect (Samsung Health, etc.). */
export interface StepsSample {
  startTime: number;
  endTime: number;
  count: number;
}

export interface WorkoutSample {
  id: string;
  name: string;
  startTime: number;
  endTime: number;
  durationMin: number;
  caloriesKcal?: number;
  sportType?: string;
}

export interface ActivitySnapshot {
  deviceId: string;
  date: string; // YYYY-MM-DD
  steps: number;
  activeMinutes?: number;
  caloriesBurned?: number;
  workouts: WorkoutSample[];
  syncedAt: number;
  source: 'health_connect' | 'manual' | 'watch' | 'samsung_health';
}
