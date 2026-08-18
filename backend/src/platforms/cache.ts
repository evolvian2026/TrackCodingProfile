import type { DataStatus, Platform } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { logger } from '../lib/logger.js';
import { getCacheSettings } from '../services/settings.service.js';

export interface CachedEntry<T> {
  payload: T;
  status: DataStatus;
  fetchedAt: Date;
}

const key = (platform: Platform, username: string, scope: string) =>
  `${platform}:${username.toLowerCase()}:${scope}`;

export async function readCache<T>(
  platform: Platform,
  username: string,
  scope = 'snapshot',
): Promise<CachedEntry<T> | null> {
  try {
    const row = await prisma.platformCache.findUnique({ where: { key: key(platform, username, scope) } });
    if (!row || row.expiresAt <= new Date()) return null;
    return { payload: row.payload as T, status: row.status, fetchedAt: row.fetchedAt };
  } catch (err) {
    logger.warn('Platform cache read failed; continuing without cache', (err as Error).message);
    return null;
  }
}

export async function writeCache(
  platform: Platform,
  username: string,
  payload: unknown,
  status: DataStatus,
  scope = 'snapshot',
): Promise<void> {
  try {
    const settings = await getCacheSettings();
    const minutes = status === 'AVAILABLE' ? settings.ttlMinutes : settings.errorTtlMinutes;
    const expiresAt = new Date(Date.now() + minutes * 60_000);
    const k = key(platform, username, scope);
    await prisma.platformCache.upsert({
      where: { key: k },
      create: { key: k, platform, payload: payload as object, status, expiresAt },
      update: { payload: payload as object, status, expiresAt, fetchedAt: new Date() },
    });
  } catch (err) {
    logger.warn('Platform cache write failed; data still persisted', (err as Error).message);
  }
}

export async function invalidateCache(platform?: Platform, username?: string): Promise<number> {
  const where =
    username && platform
      ? { key: { startsWith: `${platform}:${username.toLowerCase()}:` } }
      : platform
        ? { platform }
        : {};
  const res = await prisma.platformCache.deleteMany({ where });
  return res.count;
}

export async function purgeExpiredCache(): Promise<number> {
  const res = await prisma.platformCache.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return res.count;
}
