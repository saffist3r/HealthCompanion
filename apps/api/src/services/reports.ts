import {
  DEFAULT_DAILY_CARB_TARGET_G,
  toDateKey,
  summarizeGlucoseDay,
  toMgDl,
  type ActivityDaySummary,
  type DailyReport,
  type DayMacrosSummary,
  type Macros,
  type WeeklyReport,
} from '@health-companion/shared';

type MealRow = {
  eatenAt: Date;
  macrosJson: string;
};

type GlucoseRow = {
  value: number;
  unit: string;
  timestamp: Date;
};

type ActivityRow = {
  date: string;
  steps: number;
  activeMinutes: number | null;
  caloriesBurned: number | null;
  workoutsJson: string;
};

export function buildDailyReport(params: {
  date: string;
  meals: MealRow[];
  glucose: GlucoseRow[];
  activity: ActivityRow | null;
}): DailyReport {
  const nutrition = summarizeNutrition(params.date, params.meals);
  const glucose = summarizeGlucoseDay(
    params.date,
    params.glucose.map((g) => ({
      value: g.value,
      unit: (g.unit === 'mg/dL' ? 'mg/dL' : 'mmol/L') as 'mg/dL' | 'mmol/L',
      timestamp: g.timestamp.getTime(),
    })),
    toMgDl
  );
  const activity = params.activity ? mapActivity(params.activity) : null;
  const insights: string[] = [];
  const warnings: DailyReport['warnings'] = [];

  if (nutrition.mealCount === 0) {
    insights.push('No meals logged this day.');
  } else {
    insights.push(
      `${nutrition.mealCount} meal(s): ~${nutrition.macros.carbsG}g carbs, ${nutrition.macros.proteinG}g protein.`
    );
  }

  if (nutrition.macros.carbsG > DEFAULT_DAILY_CARB_TARGET_G) {
    warnings.push({
      severity: 'caution',
      title: 'Above daily carb target',
      message: `Logged ${nutrition.macros.carbsG}g carbs vs target ${DEFAULT_DAILY_CARB_TARGET_G}g.`,
    });
  }

  if (glucose.timeInRangePct != null) {
    insights.push(`Time in range (70–180): ${glucose.timeInRangePct}%.`);
    if (glucose.timeInRangePct < 50) {
      warnings.push({
        severity: 'alert',
        title: 'Low time in range',
        message: 'Less than half of readings were in range today.',
      });
    }
  } else {
    insights.push('No glucose samples synced for this day.');
  }

  if (activity) {
    insights.push(`${activity.steps.toLocaleString()} steps.`);
  }

  return {
    date: params.date,
    generatedAt: Date.now(),
    nutrition,
    glucose,
    activity,
    insights,
    warnings,
  };
}

export function buildWeeklyReport(params: {
  weekStart: string;
  weekEnd: string;
  days: DailyReport[];
}): WeeklyReport {
  const macros = emptyMacros();
  let mealCount = 0;
  let totalSteps = 0;
  const tirValues: number[] = [];
  const avgGlucose: number[] = [];

  for (const d of params.days) {
    mealCount += d.nutrition.mealCount;
    totalSteps += d.activity?.steps ?? 0;
    macros.carbsG += d.nutrition.macros.carbsG;
    macros.proteinG += d.nutrition.macros.proteinG;
    macros.fatG += d.nutrition.macros.fatG;
    macros.fiberG = (macros.fiberG || 0) + (d.nutrition.macros.fiberG || 0);
    macros.caloriesKcal = (macros.caloriesKcal || 0) + (d.nutrition.macros.caloriesKcal || 0);
    macros.sugarG = (macros.sugarG || 0) + (d.nutrition.macros.sugarG || 0);
    if (d.glucose.timeInRangePct != null) tirValues.push(d.glucose.timeInRangePct);
    if (d.glucose.avgMgDl != null) avgGlucose.push(d.glucose.avgMgDl);
  }

  const insights: string[] = [
    `${mealCount} meals logged across the week.`,
    `Total carbs ~${Math.round(macros.carbsG)}g.`,
    `Total steps: ${totalSteps.toLocaleString()}.`,
  ];
  if (tirValues.length) {
    const avgTir = tirValues.reduce((a, b) => a + b, 0) / tirValues.length;
    insights.push(`Average time in range: ${Math.round(avgTir * 10) / 10}%.`);
  }

  return {
    weekStart: params.weekStart,
    weekEnd: params.weekEnd,
    generatedAt: Date.now(),
    days: params.days,
    totals: {
      macros: roundMacros(macros),
      mealCount,
      avgGlucoseMgDl: avg(avgGlucose),
      avgTimeInRangePct: avg(tirValues),
      totalSteps,
    },
    insights,
  };
}

function summarizeNutrition(date: string, meals: MealRow[]): DayMacrosSummary {
  const macros = emptyMacros();
  for (const m of meals) {
    try {
      const mac = JSON.parse(m.macrosJson) as Macros;
      macros.carbsG += mac.carbsG || 0;
      macros.proteinG += mac.proteinG || 0;
      macros.fatG += mac.fatG || 0;
      macros.fiberG = (macros.fiberG || 0) + (mac.fiberG || 0);
      macros.caloriesKcal = (macros.caloriesKcal || 0) + (mac.caloriesKcal || 0);
      macros.sugarG = (macros.sugarG || 0) + (mac.sugarG || 0);
    } catch {
      /* ignore */
    }
  }
  return { date, mealCount: meals.length, macros: roundMacros(macros) };
}

function mapActivity(row: ActivityRow): ActivityDaySummary {
  let workouts: ActivityDaySummary['workouts'] = [];
  try {
    workouts = JSON.parse(row.workoutsJson);
  } catch {
    workouts = [];
  }
  return {
    date: row.date,
    steps: row.steps,
    activeMinutes: row.activeMinutes ?? undefined,
    caloriesBurned: row.caloriesBurned ?? undefined,
    workouts,
  };
}

function emptyMacros(): Macros {
  return { carbsG: 0, proteinG: 0, fatG: 0, fiberG: 0, caloriesKcal: 0, sugarG: 0 };
}

function roundMacros(m: Macros): Macros {
  const r = (n: number) => Math.round(n * 10) / 10;
  return {
    carbsG: r(m.carbsG),
    proteinG: r(m.proteinG),
    fatG: r(m.fatG),
    fiberG: r(m.fiberG || 0),
    caloriesKcal: r(m.caloriesKcal || 0),
    sugarG: r(m.sugarG || 0),
  };
}

function avg(nums: number[]): number | null {
  if (!nums.length) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
}

export function listDateKeysInclusive(start: string, end: string): string[] {
  const out: string[] = [];
  const cur = new Date(start + 'T12:00:00');
  const last = new Date(end + 'T12:00:00');
  while (cur <= last) {
    out.push(toDateKey(cur.getTime()));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

export { toDateKey };
