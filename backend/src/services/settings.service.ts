import type { Platform } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { logger } from '../lib/logger.js';
import {
  DEFAULT_CACHE_SETTINGS,
  DEFAULT_PLATFORM_COLORS,
  DEFAULT_PROCESSING_LIMITS,
  DEFAULT_SCORING_TARGETS,
  DEFAULT_SCORING_WEIGHTS,
  DEFAULT_SKILL_THRESHOLDS,
  SETTING_DEFAULTS,
  SETTING_KEYS,
  type CacheSettings,
  type ProcessingLimits,
  type ScoringTargets,
  type ScoringWeights,
  type SettingKey,
  type SkillThresholds,
} from '../config/defaults.js';

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

const TTL_MS = 15_000;
const memo = new Map<string, CacheEntry>();

/** Drop the in-process settings cache (called after any settings write). */
export function clearSettingsCache(key?: SettingKey) {
  if (key) memo.delete(key);
  else memo.clear();
}

async function readSetting<T>(key: SettingKey, fallback: T): Promise<T> {
  const cached = memo.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value as T;

  let value: T = fallback;
  try {
    const row = await prisma.appSetting.findUnique({ where: { key } });
    if (row) value = { ...fallback, ...(row.value as object) } as T;
  } catch (err) {
    // Settings must never take the app down — defaults keep processing alive.
    logger.debug(`Settings read failed for ${key}; using defaults`, (err as Error).message);
  }
  memo.set(key, { value, expiresAt: Date.now() + TTL_MS });
  return value;
}

export const getScoringWeights = () => readSetting<ScoringWeights>(SETTING_KEYS.scoringWeights, DEFAULT_SCORING_WEIGHTS);
export const getScoringTargets = () => readSetting<ScoringTargets>(SETTING_KEYS.scoringTargets, DEFAULT_SCORING_TARGETS);
export const getSkillThresholds = () =>
  readSetting<SkillThresholds>(SETTING_KEYS.skillThresholds, DEFAULT_SKILL_THRESHOLDS);
export const getCacheSettings = () => readSetting<CacheSettings>(SETTING_KEYS.cache, DEFAULT_CACHE_SETTINGS);
export const getPlatformColors = () =>
  readSetting<Record<Platform, { light: string; dark: string }>>(
    SETTING_KEYS.platformColors,
    DEFAULT_PLATFORM_COLORS,
  );

export async function getProcessingLimits(): Promise<ProcessingLimits> {
  const stored = await readSetting<ProcessingLimits>(SETTING_KEYS.processingLimits, DEFAULT_PROCESSING_LIMITS);
  return {
    ...stored,
    perPlatformRatePerMinute: {
      ...DEFAULT_PROCESSING_LIMITS.perPlatformRatePerMinute,
      ...stored.perPlatformRatePerMinute,
    },
  };
}

export async function getAllSettings() {
  const [weights, targets, skills, limits, cache, colors] = await Promise.all([
    getScoringWeights(),
    getScoringTargets(),
    getSkillThresholds(),
    getProcessingLimits(),
    getCacheSettings(),
    getPlatformColors(),
  ]);
  return {
    [SETTING_KEYS.scoringWeights]: weights,
    [SETTING_KEYS.scoringTargets]: targets,
    [SETTING_KEYS.skillThresholds]: skills,
    [SETTING_KEYS.processingLimits]: limits,
    [SETTING_KEYS.cache]: cache,
    [SETTING_KEYS.platformColors]: colors,
  };
}

export async function updateSetting(key: SettingKey, patch: Record<string, unknown>) {
  const current = (await readSetting<Record<string, unknown>>(key, SETTING_DEFAULTS[key] as Record<string, unknown>)) ?? {};
  const value = { ...current, ...patch };
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value: value as object },
    update: { value: value as object },
  });
  clearSettingsCache(key);
  return value;
}

export async function resetSetting(key: SettingKey) {
  await prisma.appSetting.deleteMany({ where: { key } });
  clearSettingsCache(key);
  return SETTING_DEFAULTS[key];
}
