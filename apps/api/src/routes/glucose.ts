import { Router } from 'express';
import { prisma, ensureDevice } from '../db';

export const glucoseRouter = Router();

function deviceId(req: { header: (n: string) => string | undefined }): string {
  return (req.header('x-device-id') || '').trim();
}

/** Bulk upsert glucose samples from the phone CapAPS history. */
glucoseRouter.post('/sync', async (req, res) => {
  try {
    const id = deviceId(req);
    await ensureDevice(id);
    const readings = Array.isArray(req.body?.readings) ? req.body.readings : [];
    let inserted = 0;
    for (const r of readings.slice(0, 500)) {
      if (typeof r.value !== 'number' || !r.unit || !r.timestamp) continue;
      const ts = new Date(r.timestamp);
      const existing = await prisma.glucoseSample.findFirst({
        where: {
          deviceId: id,
          timestamp: ts,
          value: r.value,
        },
      });
      if (existing) continue;
      await prisma.glucoseSample.create({
        data: {
          deviceId: id,
          value: r.value,
          unit: r.unit,
          timestamp: ts,
        },
      });
      inserted += 1;
    }
    res.json({ ok: true, inserted });
  } catch (e) {
    const err = e as Error & { status?: number };
    res.status(err.status || 500).json({ error: err.message || 'sync failed' });
  }
});
