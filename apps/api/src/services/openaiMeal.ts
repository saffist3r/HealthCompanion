import OpenAI from 'openai';
import {
  evaluateMealWarnings,
  sumMacros,
  type FoodItem,
  type Macros,
  type MealAnalysisResult,
  type MealType,
} from '@health-companion/shared';

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

function getClient(): OpenAI {
  const key = process.env.OPENAI_API_KEY;
  if (!key || key.startsWith('sk-your-key')) {
    throw new Error('OPENAI_API_KEY is not configured on the server');
  }
  return new OpenAI({ apiKey: key });
}

const SYSTEM = `You are a nutrition assistant for people with diabetes.
Analyze a meal photo and estimate food items and macronutrients.
Be conservative with carb estimates when unsure — note uncertainty.
Never give medical advice or insulin dosing; suggestions are lifestyle/nutrition only.
Respond with JSON only matching this schema:
{
  "items": [{"name": string, "portion": string, "macros": {"carbsG": number, "proteinG": number, "fatG": number, "fiberG": number, "caloriesKcal": number, "sugarG": number}, "confidence": number}],
  "mealTypeGuess": "breakfast"|"lunch"|"dinner"|"snack"|"resucrage"|"other",
  "summary": string,
  "carbEstimateNote": string,
  "suggestions": string[]
}`;

export async function analyzeMealPhoto(params: {
  imageBase64: string;
  mimeType: string;
  glucoseMgDl?: number | null;
  hourLocal?: number;
  notes?: string;
}): Promise<MealAnalysisResult> {
  const client = getClient();
  const userText = [
    'Estimate the meal in this photo.',
    params.notes ? `User notes: ${params.notes}` : null,
    params.glucoseMgDl != null ? `Latest glucose ~${Math.round(params.glucoseMgDl)} mg/dL` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const completion = await client.chat.completions.create({
    model: MODEL,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: [
          { type: 'text', text: userText },
          {
            type: 'image_url',
            image_url: {
              url: `data:${params.mimeType};base64,${params.imageBase64}`,
            },
          },
        ],
      },
    ],
    temperature: 0.2,
  });

  const raw = completion.choices[0]?.message?.content ?? '{}';
  let parsed: {
    items?: FoodItem[];
    mealTypeGuess?: MealType;
    summary?: string;
    carbEstimateNote?: string;
    suggestions?: string[];
  };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('AI returned invalid JSON');
  }

  const items = normalizeItems(parsed.items ?? []);
  const macros = sumMacros(items);
  const warnings = evaluateMealWarnings(macros, {
    hourLocal: params.hourLocal,
    glucoseMgDl: params.glucoseMgDl,
  });

  return {
    items,
    macros,
    mealTypeGuess: parsed.mealTypeGuess,
    summary: parsed.summary || 'Meal analyzed.',
    carbEstimateNote:
      parsed.carbEstimateNote ||
      `Estimated ~${macros.carbsG}g carbohydrates. Photo estimates can be off by 20–40%.`,
    suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 6) : [],
    warnings,
  };
}

function normalizeItems(items: FoodItem[]): FoodItem[] {
  return items.map((item) => ({
    name: String(item.name || 'Food').slice(0, 120),
    portion: item.portion ? String(item.portion).slice(0, 80) : undefined,
    confidence:
      typeof item.confidence === 'number'
        ? Math.min(1, Math.max(0, item.confidence))
        : undefined,
    macros: normalizeMacros(item.macros),
  }));
}

function normalizeMacros(m?: Partial<Macros>): Macros {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : 0);
  const carbsG = n(m?.carbsG);
  const proteinG = n(m?.proteinG);
  const fatG = n(m?.fatG);
  let caloriesKcal = n(m?.caloriesKcal);
  if (caloriesKcal <= 0 && (carbsG || proteinG || fatG)) {
    caloriesKcal = Math.round(carbsG * 4 + proteinG * 4 + fatG * 9);
  }
  return {
    carbsG,
    proteinG,
    fatG,
    fiberG: n(m?.fiberG),
    caloriesKcal,
    sugarG: n(m?.sugarG),
  };
}
