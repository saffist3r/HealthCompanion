import { Router } from 'express';
import { prisma, ensureDevice } from '../db';
import {
  buildDailyReport,
  buildWeeklyReport,
  listDateKeysInclusive,
  toDateKey,
} from '../services/reports';

export const reportsRouter = Router();

function deviceId(req: { header: (n: string) => string | undefined }): string {
  return (req.header('x-device-id') || '').trim();
}

function mondayOf(dateKey: string): string {
  const d = new Date(dateKey + 'T12:00:00');
  const day = d.getDay(); // 0 Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toDateKey(d.getTime());
}

reportsRouter.get('/daily', async (req, res) => {
  try {
    const id = deviceId(req);
    await ensureDevice(id);
    const date =
      typeof req.query.date === 'string' ? req.query.date : toDateKey(Date.now());
    const report = await loadDaily(id, date);
    res.json(report);
  } catch (e) {
    const err = e as Error & { status?: number };
    res.status(err.status || 500).json({ error: err.message || 'report failed' });
  }
});

reportsRouter.get('/weekly', async (req, res) => {
  try {
    const id = deviceId(req);
    await ensureDevice(id);
    const anchor =
      typeof req.query.date === 'string' ? req.query.date : toDateKey(Date.now());
    const weekStart = mondayOf(anchor);
    const end = new Date(weekStart + 'T12:00:00');
    end.setDate(end.getDate() + 6);
    const weekEnd = toDateKey(end.getTime());
    const dates = listDateKeysInclusive(weekStart, weekEnd);
    const days = [];
    for (const date of dates) {
      days.push(await loadDaily(id, date));
    }
    res.json(buildWeeklyReport({ weekStart, weekEnd, days }));
  } catch (e) {
    const err = e as Error & { status?: number };
    res.status(err.status || 500).json({ error: err.message || 'report failed' });
  }
});

async function loadDaily(deviceId: string, date: string) {
  const start = new Date(`${date}T00:00:00`);
  const end = new Date(`${date}T23:59:59.999`);
  const [meals, glucose, activity] = await Promise.all([
    prisma.meal.findMany({
      where: { deviceId, eatenAt: { gte: start, lte: end } },
      orderBy: { eatenAt: 'asc' },
    }),
    prisma.glucoseSample.findMany({
      where: { deviceId, timestamp: { gte: start, lte: end } },
      orderBy: { timestamp: 'asc' },
    }),
    prisma.activityDay.findUnique({
      where: { deviceId_date: { deviceId, date } },
    }),
  ]);
  return buildDailyReport({ date, meals, glucose, activity });
}
