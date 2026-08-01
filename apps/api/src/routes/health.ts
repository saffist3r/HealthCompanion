import { Router } from 'express';
import { prisma, ensureDevice } from '../db';

export const healthRouter = Router();

function deviceId(req: { header: (n: string) => string | undefined }): string {
  return (req.header('x-device-id') || '').trim();
}

/** Upsert daily activity from Health Connect / Samsung Health. */
healthRouter.post('/activity', async (req, res) => {
  try {
    const id = deviceId(req);
    await ensureDevice(id);
    const body = req.body || {};
    const date = body.date;
    if (!date || typeof date !== 'string') {
      res.status(400).json({ error: 'date (YYYY-MM-DD) required' });
      return;
    }
    const row = await prisma.activityDay.upsert({
      where: { deviceId_date: { deviceId: id, date } },
      create: {
        deviceId: id,
        date,
        steps: Number(body.steps) || 0,
        activeMinutes: body.activeMinutes != null ? Number(body.activeMinutes) : null,
        caloriesBurned: body.caloriesBurned != null ? Number(body.caloriesBurned) : null,
        workoutsJson: JSON.stringify(body.workouts || []),
        source: body.source || 'health_connect',
      },
      update: {
        steps: Number(body.steps) || 0,
        activeMinutes: body.activeMinutes != null ? Number(body.activeMinutes) : null,
        caloriesBurned: body.caloriesBurned != null ? Number(body.caloriesBurned) : null,
        workoutsJson: JSON.stringify(body.workouts || []),
        syncedAt: new Date(),
        source: body.source || 'health_connect',
      },
    });
    res.json({ ok: true, activity: row });
  } catch (e) {
    const err = e as Error & { status?: number };
    res.status(err.status || 500).json({ error: err.message || 'activity sync failed' });
  }
});

healthRouter.get('/activity', async (req, res) => {
  try {
    const id = deviceId(req);
    await ensureDevice(id);
    const date = typeof req.query.date === 'string' ? req.query.date : undefined;
    if (date) {
      const row = await prisma.activityDay.findUnique({
        where: { deviceId_date: { deviceId: id, date } },
      });
      res.json({ activity: row });
      return;
    }
    const rows = await prisma.activityDay.findMany({
      where: { deviceId: id },
      orderBy: { date: 'desc' },
      take: 30,
    });
    res.json({ activity: rows });
  } catch (e) {
    const err = e as Error & { status?: number };
    res.status(err.status || 500).json({ error: err.message || 'list failed' });
  }
});
