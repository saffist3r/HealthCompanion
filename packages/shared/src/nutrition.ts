/** Macronutrients for a meal or day (grams unless noted). */
export interface Macros {
  carbsG: number;
  proteinG: number;
  fatG: number;
  fiberG?: number;
  caloriesKcal?: number;
  sugarG?: number;
}

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'resucrage' | 'other';

export const MEAL_TYPE_OPTIONS: Array<{ id: MealType; label: string }> = [
  { id: 'breakfast', label: 'Breakfast' },
  { id: 'lunch', label: 'Lunch' },
  { id: 'dinner', label: 'Dinner' },
  { id: 'snack', label: 'Snack' },
  { id: 'resucrage', label: 'Resucrage' },
  { id: 'other', label: 'Other' },
];

export function mealTypeLabel(type: string | null | undefined): string {
  const found = MEAL_TYPE_OPTIONS.find((o) => o.id === type);
  if (found) return found.label;
  if (!type) return 'Other';
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export interface FoodItem {
  name: string;
  portion?: string;
  macros: Macros;
  confidence?: number; // 0–1 from AI
}

/** Role for a meal photo (main plate, dessert, drink, etc.). */
export type MealPhotoRole = 'main' | 'side' | 'dessert' | 'drink' | 'other';

export const MEAL_PHOTO_ROLE_OPTIONS: Array<{ id: MealPhotoRole; label: string }> = [
  { id: 'main', label: 'Main' },
  { id: 'side', label: 'Side' },
  { id: 'dessert', label: 'Dessert' },
  { id: 'drink', label: 'Drink' },
  { id: 'other', label: 'Other' },
];

export function mealPhotoRoleLabel(role: string | null | undefined): string {
  const found = MEAL_PHOTO_ROLE_OPTIONS.find((o) => o.id === role);
  if (found) return found.label;
  if (!role) return 'Photo';
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export interface MealPhoto {
  /** Relative upload URL, e.g. `/uploads/….jpg` */
  url: string;
  /** Filename stored on the server (create/update payloads). */
  path?: string;
  role?: MealPhotoRole;
  label?: string;
}

/** Payload entry when creating/updating a meal with multiple photos. */
export interface MealPhotoInput {
  path: string;
  role?: MealPhotoRole;
  label?: string;
}

export interface MealEntry {
  id: string;
  deviceId: string;
  createdAt: number;
  eatenAt: number;
  mealType: MealType;
  /** Primary / thumbnail photo (usually the main dish). */
  photoUrl?: string;
  /** All meal photos (main, dessert, etc.). Empty or omitted for older meals. */
  photos?: MealPhoto[];
  items: FoodItem[];
  macros: Macros;
  notes?: string;
  aiSummary?: string;
  carbEstimateNote?: string;
  warnings: DiabetesWarning[];
  source: 'ai_photo' | 'manual' | 'imported';
}

export type DiabetesWarningSeverity = 'info' | 'caution' | 'alert';

export type DiabetesWarningCode =
  | 'high_carb_meal'
  | 'very_high_carb_meal'
  | 'low_fiber_high_carb'
  | 'late_large_meal'
  | 'rapid_rise_risk'
  | 'hypo_risk_after_exercise'
  | 'missing_protein'
  | 'daily_carb_over_target'
  | 'daily_carb_under_target'
  | 'glucose_high_with_meal'
  | 'glucose_low_with_meal';

export interface DiabetesWarning {
  code: DiabetesWarningCode;
  severity: DiabetesWarningSeverity;
  title: string;
  message: string;
}

export interface MealAnalysisResult {
  items: FoodItem[];
  macros: Macros;
  mealTypeGuess?: MealType;
  summary: string;
  carbEstimateNote: string;
  suggestions: string[];
  warnings: DiabetesWarning[];
}

/** Default carb targets (grams) — user-overridable later. */
export const DEFAULT_DAILY_CARB_TARGET_G = 180;
export const HIGH_MEAL_CARB_G = 45;
export const VERY_HIGH_MEAL_CARB_G = 75;

/** Atwater estimate when calories aren't provided. */
export function estimateCaloriesKcal(macros: Pick<Macros, 'carbsG' | 'proteinG' | 'fatG'>): number {
  return Math.round((macros.carbsG || 0) * 4 + (macros.proteinG || 0) * 4 + (macros.fatG || 0) * 9);
}

/** Prefer stored calories; fall back to Atwater estimate. */
export function resolvedCaloriesKcal(macros: Macros | null | undefined): number {
  if (!macros) return 0;
  const stored = macros.caloriesKcal;
  if (typeof stored === 'number' && stored > 0) return Math.round(stored);
  return estimateCaloriesKcal(macros);
}

export function sumMacros(items: FoodItem[]): Macros {
  const summed = items.reduce(
    (acc, item) => {
      const itemKcal =
        item.macros.caloriesKcal && item.macros.caloriesKcal > 0
          ? item.macros.caloriesKcal
          : estimateCaloriesKcal(item.macros);
      return {
        carbsG: round1(acc.carbsG + (item.macros.carbsG || 0)),
        proteinG: round1(acc.proteinG + (item.macros.proteinG || 0)),
        fatG: round1(acc.fatG + (item.macros.fatG || 0)),
        fiberG: round1((acc.fiberG || 0) + (item.macros.fiberG || 0)),
        caloriesKcal: round1((acc.caloriesKcal || 0) + itemKcal),
        sugarG: round1((acc.sugarG || 0) + (item.macros.sugarG || 0)),
      };
    },
    { carbsG: 0, proteinG: 0, fatG: 0, fiberG: 0, caloriesKcal: 0, sugarG: 0 }
  );
  return summed;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function evaluateMealWarnings(
  macros: Macros,
  opts?: { hourLocal?: number; glucoseMgDl?: number | null }
): DiabetesWarning[] {
  const warnings: DiabetesWarning[] = [];
  const hour = opts?.hourLocal ?? new Date().getHours();
  const bg = opts?.glucoseMgDl;

  if (macros.carbsG >= VERY_HIGH_MEAL_CARB_G) {
    warnings.push({
      code: 'very_high_carb_meal',
      severity: 'alert',
      title: 'Very high carbs',
      message: `This meal is ~${macros.carbsG}g carbs. Consider splitting the portion, adding fiber/protein, or adjusting insulin with your care team’s guidance.`,
    });
  } else if (macros.carbsG >= HIGH_MEAL_CARB_G) {
    warnings.push({
      code: 'high_carb_meal',
      severity: 'caution',
      title: 'High carb meal',
      message: `About ${macros.carbsG}g carbs — watch your glucose trend for the next 2–3 hours.`,
    });
  }

  if (macros.carbsG >= HIGH_MEAL_CARB_G && (macros.fiberG ?? 0) < 5) {
    warnings.push({
      code: 'low_fiber_high_carb',
      severity: 'caution',
      title: 'Low fiber with high carbs',
      message: 'Adding vegetables or whole grains may slow the glucose rise.',
    });
  }

  if (macros.proteinG < 10 && macros.carbsG >= 30) {
    warnings.push({
      code: 'missing_protein',
      severity: 'info',
      title: 'Little protein',
      message: 'Protein can help blunt post-meal spikes when paired with carbs.',
    });
  }

  if (hour >= 21 && macros.carbsG >= HIGH_MEAL_CARB_G) {
    warnings.push({
      code: 'late_large_meal',
      severity: 'caution',
      title: 'Late large meal',
      message: 'Large carb meals late at night can raise overnight glucose.',
    });
  }

  if (bg != null && bg >= 180 && macros.carbsG >= 30) {
    warnings.push({
      code: 'glucose_high_with_meal',
      severity: 'alert',
      title: 'Glucose already high',
      message: `Current glucose ~${Math.round(bg)} mg/dL with a carb-containing meal — consider checking again soon.`,
    });
  }

  if (bg != null && bg < 70) {
    warnings.push({
      code: 'glucose_low_with_meal',
      severity: 'alert',
      title: 'Glucose is low',
      message: 'Treat hypoglycemia per your plan before focusing on meal macros.',
    });
  }

  return warnings;
}
