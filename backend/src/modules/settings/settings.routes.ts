import { Router } from 'express';
import { z } from 'zod';
import { ALL_PLATFORMS, PLATFORMS } from '../../config/platforms.js';
import { SETTING_DEFAULTS, SETTING_KEYS, type SettingKey } from '../../config/defaults.js';
import { env } from '../../config/env.js';
import { asyncHandler } from '../../middleware/error.js';
import { requireAdmin, requireAuth } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { badRequest } from '../../lib/errors.js';
import { invalidateCache, purgeExpiredCache } from '../../platforms/cache.js';
import { bucketStatus } from '../../platforms/rateLimiter.js';
import { getAllSettings, resetSetting, updateSetting } from '../../services/settings.service.js';
import { recomputeAllAnalytics } from '../../services/analytics.service.js';

const VALID_KEYS = new Set<string>(Object.values(SETTING_KEYS));

const weightSchema = z.object({
  problemsSolved: z.number().min(0).max(100).optional(),
  problemDifficulty: z.number().min(0).max(100).optional(),
  contestParticipation: z.number().min(0).max(100).optional(),
  contestRating: z.number().min(0).max(100).optional(),
  topicCoverage: z.number().min(0).max(100).optional(),
});

const targetSchema = z.object({
  problemsSolvedTarget: z.number().int().min(1).max(100_000).optional(),
  difficultyPointsTarget: z.number().int().min(1).max(1_000_000).optional(),
  contestsTarget: z.number().int().min(1).max(1_000).optional(),
  ratingTarget: z.number().int().min(900).max(5_000).optional(),
  topicsTarget: z.number().int().min(1).max(200).optional(),
  difficultyPoints: z
    .object({
      easy: z.number().min(0).max(100),
      medium: z.number().min(0).max(100),
      hard: z.number().min(0).max(100),
      unknown: z.number().min(0).max(100),
    })
    .optional(),
});

const skillSchema = z.object({
  beginner: z.number().min(0).optional(),
  intermediate: z.number().min(0).optional(),
  advanced: z.number().min(0).optional(),
  expert: z.number().min(0).optional(),
  platformDiversityBonus: z.number().min(0).max(2).optional(),
  recentActivityBonus: z.number().min(0).max(2).optional(),
  recentActivityWindowDays: z.number().int().min(1).max(365).optional(),
});

const limitsSchema = z.object({
  concurrency: z.number().int().min(1).max(64).optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
  retryBaseDelayMs: z.number().int().min(100).max(60_000).optional(),
  retryMaxDelayMs: z.number().int().min(1_000).max(600_000).optional(),
  jitterMs: z.number().int().min(0).max(10_000).optional(),
  requestTimeoutMs: z.number().int().min(1_000).max(120_000).optional(),
  perPlatformRatePerMinute: z.record(z.enum(ALL_PLATFORMS as [string, ...string[]]), z.number().int().min(1).max(600)).optional(),
});

const cacheSchema = z.object({
  ttlMinutes: z.number().int().min(0).max(43_200).optional(),
  errorTtlMinutes: z.number().int().min(0).max(43_200).optional(),
});

const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a 6-digit hex colour');
const colorSchema = z.record(
  z.enum(ALL_PLATFORMS as [string, ...string[]]),
  z.object({ light: hex, dark: hex }),
);

const SCHEMAS: Record<SettingKey, z.ZodTypeAny> = {
  [SETTING_KEYS.scoringWeights]: weightSchema,
  [SETTING_KEYS.scoringTargets]: targetSchema,
  [SETTING_KEYS.skillThresholds]: skillSchema,
  [SETTING_KEYS.processingLimits]: limitsSchema,
  [SETTING_KEYS.cache]: cacheSchema,
  [SETTING_KEYS.platformColors]: colorSchema,
};

/** Changing these invalidates every derived score. */
const SCORE_AFFECTING = new Set<string>([
  SETTING_KEYS.scoringWeights,
  SETTING_KEYS.scoringTargets,
  SETTING_KEYS.skillThresholds,
]);

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

settingsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({
      data: await getAllSettings(),
      defaults: SETTING_DEFAULTS,
      runtime: {
        dataSource: env.DATA_SOURCE,
        queueDriver: env.QUEUE_DRIVER,
        maxUploadMb: env.MAX_UPLOAD_MB,
        maxUploadRows: env.MAX_UPLOAD_ROWS,
        rateLimiters: bucketStatus(),
      },
    });
  }),
);

settingsRouter.patch(
  '/:key',
  requireAdmin,
  validateBody(z.object({ value: z.record(z.string(), z.unknown()), recompute: z.boolean().default(false) })),
  asyncHandler(async (req, res) => {
    const key = decodeURIComponent(req.params.key!);
    if (!VALID_KEYS.has(key)) throw badRequest(`Unknown setting "${key}"`);

    const parsed = SCHEMAS[key as SettingKey].safeParse(req.body.value);
    if (!parsed.success) throw badRequest('Invalid setting value', parsed.error.issues);

    const value = await updateSetting(key as SettingKey, parsed.data as Record<string, unknown>);

    let recomputed: number | undefined;
    if (req.body.recompute && SCORE_AFFECTING.has(key)) recomputed = await recomputeAllAnalytics();

    res.json({ data: { key, value }, recomputed });
  }),
);

settingsRouter.post(
  '/:key/reset',
  requireAdmin,
  validateBody(z.object({ recompute: z.boolean().default(true) })),
  asyncHandler(async (req, res) => {
    const key = decodeURIComponent(req.params.key!);
    if (!VALID_KEYS.has(key)) throw badRequest(`Unknown setting "${key}"`);

    const value = await resetSetting(key as SettingKey);

    // A reset changes the scores exactly as much as an edit does. Without this
    // every stored cpScore stays as it was computed under the old weights, and
    // the leaderboard silently disagrees with the settings that produced it.
    const recomputed = req.body.recompute && SCORE_AFFECTING.has(key) ? await recomputeAllAnalytics() : undefined;

    res.json({ data: { key, value }, recomputed });
  }),
);

/** Platform metadata + cache maintenance. */
settingsRouter.get('/platforms/meta', (_req, res) => {
  res.json({
    data: ALL_PLATFORMS.map((p) => ({
      key: p,
      label: PLATFORMS[p].label,
      color: PLATFORMS[p].colors.light,
      colorDark: PLATFORMS[p].colors.dark,
      usernameField: PLATFORMS[p].usernameField,
      capabilities: {
        hasDifficultyBreakdown: PLATFORMS[p].hasDifficultyBreakdown,
        hasContests: PLATFORMS[p].hasContests,
        hasTopics: PLATFORMS[p].hasTopics,
      },
      defaultRateLimitPerMinute: PLATFORMS[p].defaultRateLimitPerMinute,
      dataSourceNote: PLATFORMS[p].docsNote,
    })),
    dataSource: env.DATA_SOURCE,
  });
});

settingsRouter.post(
  '/cache/purge',
  requireAdmin,
  validateBody(z.object({ platform: z.enum(ALL_PLATFORMS as [string, ...string[]]).optional(), expiredOnly: z.boolean().default(false) })),
  asyncHandler(async (req, res) => {
    const removed = req.body.expiredOnly ? await purgeExpiredCache() : await invalidateCache(req.body.platform);
    res.json({ removed });
  }),
);
