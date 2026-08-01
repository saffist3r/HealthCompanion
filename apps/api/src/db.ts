import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

export async function ensureDevice(deviceId: string) {
  if (!deviceId || deviceId.length < 8) {
    throw Object.assign(new Error('Invalid X-Device-Id'), { status: 400 });
  }
  await prisma.device.upsert({
    where: { id: deviceId },
    create: { id: deviceId },
    update: {},
  });
}
