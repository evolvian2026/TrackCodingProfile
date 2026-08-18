import { Router } from 'express';
import { z } from 'zod';
import { ALL_PLATFORMS } from '../../config/platforms.js';
import { asyncHandler } from '../../middleware/error.js';
import { requireAuth, requireTrainer } from '../../middleware/auth.js';
import { parsedQuery, validateQuery } from '../../middleware/validate.js';
import { badRequest } from '../../lib/errors.js';
import { recomputeAllAnalytics } from '../../services/analytics.service.js';
import type { StudentFilters } from '../students/students.service.js';
import * as aggregate from './aggregate.service.js';

const platformEnum = z.enum(ALL_PLATFORMS as [string, ...string[]]);
const numeric = z.coerce.number().optional();

const filterSchema = z.object({
  university: z.string().optional(),
  college: z.string().optional(),
  batch: z.string().optional(),
  branch: z.string().optional(),
  section: z.string().optional(),
  platform: platformEnum.optional(),
  search: z.string().optional(),
  minRating: numeric,
  maxRating: numeric,
  minSolved: numeric,
  maxSolved: numeric,
  minContests: numeric,
  minScore: numeric,
});

export const analyticsRouter = Router();
analyticsRouter.use(requireAuth);

analyticsRouter.get(
  '/overview',
  validateQuery(filterSchema),
  asyncHandler(async (req, res) => res.json({ data: await aggregate.getOverview(parsedQuery<StudentFilters>(req)) })),
);

analyticsRouter.get(
  '/topics',
  validateQuery(filterSchema),
  asyncHandler(async (req, res) => {
    const filters = parsedQuery<StudentFilters & { platform?: never }>(req);
    const { platform, ...rest } = filters;
    res.json({ data: await aggregate.getTopicAnalytics(rest, platform) });
  }),
);

analyticsRouter.get(
  '/difficulty',
  validateQuery(filterSchema),
  asyncHandler(async (req, res) => res.json({ data: await aggregate.getDifficultyAnalytics(parsedQuery<StudentFilters>(req)) })),
);

analyticsRouter.get(
  '/batch',
  validateQuery(filterSchema.extend({ batch: z.string().min(1) })),
  asyncHandler(async (req, res) => {
    const { batch, ...filters } = parsedQuery<StudentFilters & { batch: string }>(req);
    if (!batch) throw badRequest('A batch is required.');
    res.json({ data: await aggregate.getBatchAnalytics(batch, filters) });
  }),
);

analyticsRouter.get(
  '/university',
  validateQuery(filterSchema.extend({ groupBy: z.enum(['college', 'university']).default('college') })),
  asyncHandler(async (req, res) => {
    const { groupBy, ...filters } = parsedQuery<StudentFilters & { groupBy: 'college' | 'university' }>(req);
    res.json({ data: await aggregate.getInstitutionAnalytics(groupBy, filters) });
  }),
);

analyticsRouter.get(
  '/growth',
  validateQuery(filterSchema.extend({ days: z.coerce.number().int().min(7).max(730).default(90) })),
  asyncHandler(async (req, res) => {
    const { days, ...filters } = parsedQuery<StudentFilters & { days: number }>(req);
    res.json({ data: await aggregate.getGrowthTrend(filters, days) });
  }),
);

/** Rebuild every derived analytic — used after changing scoring weights. */
analyticsRouter.post(
  '/recompute',
  requireTrainer,
  asyncHandler(async (_req, res) => {
    const count = await recomputeAllAnalytics();
    res.json({ message: `Recomputed analytics for ${count} students`, count });
  }),
);
