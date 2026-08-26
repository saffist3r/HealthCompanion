/** AI-generated workout plans (Gemini). */

export interface WorkoutExercise {
  name: string;
  sets?: number | null;
  reps?: string | null;
  durationMin?: number | null;
  restSec?: number | null;
  targetArea?: string | null;
  notes?: string | null;
}

export interface WorkoutPlan {
  id: string;
  title: string;
  focus?: string | null;
  durationMin?: number | null;
  summary?: string | null;
  exercises: WorkoutExercise[];
  source?: string;
  notes?: string | null;
  basedOn?: string | null;
  createdAt?: number | null;
}

export interface WorkoutPlanDraft {
  title: string;
  focus?: string | null;
  durationMin?: number | null;
  summary?: string | null;
  exercises: WorkoutExercise[];
  basedOn?: string | null;
  disclaimer?: string | null;
}
