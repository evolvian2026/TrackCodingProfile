import { Router } from 'express';
import { z } from 'zod';
import { ALL_PLATFORMS } from '../../config/platforms.js';
import { asyncHandler } from '../../middleware/error.js';
import { requireAuth } from '../../middleware/auth.js';
import { parsedQuery, validateQuery } from '../../middleware/validate.js';
import type { StudentFilters } from '../students/students.service.js';
import { getLeaderboard, type LeaderboardSort } from './aggregate.service.js';

const schema = z.object({
  university: z.string().optional(),
  college: z.string().optional(),
  batch: z.string().optional(),
  branch: z.string().optional(),
  section: z.string().optional(),
  platform: z.enum(ALL_PLATFORMS as [string, ...string[]]).optional(),
  search: z.string().optional(),
  minRating: z.coerce.number().optional(),
  minSolved: z.coerce.number().optional(),
  minContests: z.coerce.number().optional(),
  sortBy: z
    .enum(['cpScore', 'totalSolved', 'currentRating', 'bestRating', 'totalContests', 'topicCount', 'topicCoverage'])
    .default('cpScore'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const leaderboardRouter = Router();
leaderboardRouter.use(requireAuth);

leaderboardRouter.get(
  '/',
  validateQuery(schema),
  asyncHandler(async (req, res) => {
    const { sortBy, sortDir, page, pageSize, ...filters } = parsedQuery<z.infer<typeof schema>>(req);
    res.json(
      await getLeaderboard(filters as StudentFilters, {
        sortBy: sortBy as LeaderboardSort,
        sortDir,
        page,
        pageSize,
      }),
    );
  }),
);
