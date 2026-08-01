import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { evaluateMealWarnings, type MealType } from '@health-companion/shared';
import { prisma, ensureDevice } from '../db';
import { analyzeMealPhoto } from '../services/openaiMeal';
import { toDateKey } from '../services/reports';

const uploadDir = path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  }),
  limits: { fileSize: (Number(process.env.MAX_UPLOAD_MB) || 8) * 1024 * 1024 },
});

export const mealsRouter = Router();

function deviceId(req: { header: (n: string) => string | undefined }): string {
  return (req.header('x-device-id') || '').trim();
}

mealsRouter.post('/analyze', upload.single('photo'), async (req, res) => {
  try {
    const id = deviceId(req);
    await ensureDevice(id);
    if (!req.file) {
      res.status(400).json({ error: 'photo file required' });
      return;
    }
    const buf = fs.readFileSync(req.file.path);
    const mimeType = req.file.mimetype || 'image/jpeg';
    const glucoseMgDl = req.body.glucoseMgDl != null ? Number(req.body.glucoseMgDl) : null;
    const hourLocal = req.body.hourLocal != null ? Number(req.body.hourLocal) : new Date().getHours();
    const notes = typeof req.body.notes === 'string' ? req.body.notes : undefined;

    const analysis = await analyzeMealPhoto({
      imageBase64: buf.toString('base64'),
      mimeType,
      glucoseMgDl: Number.isFinite(glucoseMgDl as number) ? glucoseMgDl : null,
      hourLocal,
      notes,
    });

    res.json({
      analysis,
      photoPath: req.file.filename,
      photoUrl: `/uploads/${req.file.filename}`,
    });
  } catch (e) {
    const err = e as Error & { status?: number };
    console.error('[meals/analyze]', err);
    res.status(err.status || 500).json({ error: err.message || 'analyze failed' });
  }
});

mealsRouter.post('/', async (req, res) => {
  try {
    const id = deviceId(req);
    await ensureDevice(id);
    const body = req.body || {};
    const eatenAt = body.eatenAt ? new Date(body.eatenAt) : new Date();
    const mealType = (body.mealType || 'other') as MealType;
    const items = body.items || [];
    const macros = body.macros;
    if (!macros || typeof macros.carbsG !== 'number') {
      res.status(400).json({ error: 'macros required' });
      return;
    }
    const warnings =
      Array.isArray(body.warnings) && body.warnings.length
        ? body.warnings
        : evaluateMealWarnings(macros, {
            hourLocal: eatenAt.getHours(),
            glucoseMgDl: body.glucoseMgDl ?? null,
          });

    const meal = await prisma.meal.create({
      data: {
        deviceId: id,
        eatenAt,
        mealType,
        photoPath: body.photoPath || null,
        itemsJson: JSON.stringify(items),
        macrosJson: JSON.stringify(macros),
        notes: body.notes || null,
        aiSummary: body.aiSummary || null,
        carbEstimateNote: body.carbEstimateNote || null,
        warningsJson: JSON.stringify(warnings),
        suggestionsJson: JSON.stringify(body.suggestions || []),
        source: body.source || 'ai_photo',
      },
    });

    res.status(201).json(serializeMeal(meal));
  } catch (e) {
    const err = e as Error & { status?: number };
    console.error('[meals/create]', err);
    res.status(err.status || 500).json({ error: err.message || 'create failed' });
  }
});

mealsRouter.get('/', async (req, res) => {
  try {
    const id = deviceId(req);
    await ensureDevice(id);
    const date = typeof req.query.date === 'string' ? req.query.date : undefined;
    const limit = Math.min(Number(req.query.limit) || 50, 200);

    let meals;
    if (date) {
      const start = new Date(`${date}T00:00:00`);
      const end = new Date(`${date}T23:59:59.999`);
      meals = await prisma.meal.findMany({
        where: { deviceId: id, eatenAt: { gte: start, lte: end } },
        orderBy: { eatenAt: 'desc' },
        take: limit,
      });
    } else {
      meals = await prisma.meal.findMany({
        where: { deviceId: id },
        orderBy: { eatenAt: 'desc' },
        take: limit,
      });
    }
    res.json({ meals: meals.map(serializeMeal) });
  } catch (e) {
    const err = e as Error & { status?: number };
    res.status(err.status || 500).json({ error: err.message || 'list failed' });
  }
});

mealsRouter.delete('/:mealId', async (req, res) => {
  try {
    const id = deviceId(req);
    await ensureDevice(id);
    const meal = await prisma.meal.findFirst({
      where: { id: req.params.mealId, deviceId: id },
    });
    if (!meal) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    await prisma.meal.delete({ where: { id: meal.id } });
    res.json({ ok: true });
  } catch (e) {
    const err = e as Error & { status?: number };
    res.status(err.status || 500).json({ error: err.message || 'delete failed' });
  }
});

function serializeMeal(meal: {
  id: string;
  deviceId: string;
  createdAt: Date;
  eatenAt: Date;
  mealType: string;
  photoPath: string | null;
  itemsJson: string;
  macrosJson: string;
  notes: string | null;
  aiSummary: string | null;
  carbEstimateNote: string | null;
  warningsJson: string;
  suggestionsJson: string;
  source: string;
}) {
  return {
    id: meal.id,
    deviceId: meal.deviceId,
    createdAt: meal.createdAt.getTime(),
    eatenAt: meal.eatenAt.getTime(),
    mealType: meal.mealType,
    photoUrl: meal.photoPath ? `/uploads/${meal.photoPath}` : undefined,
    items: safeJson(meal.itemsJson, []),
    macros: safeJson(meal.macrosJson, { carbsG: 0, proteinG: 0, fatG: 0 }),
    notes: meal.notes || undefined,
    aiSummary: meal.aiSummary || undefined,
    carbEstimateNote: meal.carbEstimateNote || undefined,
    warnings: safeJson(meal.warningsJson, []),
    suggestions: safeJson(meal.suggestionsJson, []),
    source: meal.source,
    date: toDateKey(meal.eatenAt.getTime()),
  };
}

function safeJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
