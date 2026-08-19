import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { ALL_PLATFORMS, PLATFORMS } from '../../config/platforms.js';
import { asyncHandler } from '../../middleware/error.js';
import { requireAuth, requireTrainer } from '../../middleware/auth.js';
import { parsedQuery, validateBody, validateQuery } from '../../middleware/validate.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { createProcessingJob } from '../../services/processing.service.js';
import { recomputeStudentAnalytics } from '../../services/analytics.service.js';
import { invalidateCache } from '../../platforms/cache.js';
import * as students from './students.service.js';

const platformEnum = z.enum(ALL_PLATFORMS as [string, ...string[]]);

const numeric = z.coerce.number().optional();
const filterSchema = z.object({
  search: z.string().trim().max(200).optional(),
  university: z.string().optional(),
  college: z.string().optional(),
  batch: z.string().optional(),
  branch: z.string().optional(),
  section: z.string().optional(),
  platform: platformEnum.optional(),
  status: z.string().optional(),
  minRating: numeric,
  maxRating: numeric,
  minSolved: numeric,
  maxSolved: numeric,
  minContests: numeric,
  minScore: numeric,
  hasData: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
});

const listSchema = filterSchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  sortBy: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

export const studentsRouter = Router();
studentsRouter.use(requireAuth);

studentsRouter.get(
  '/',
  validateQuery(listSchema),
  asyncHandler(async (req, res) => {
    const q = parsedQuery<z.infer<typeof listSchema>>(req);
    const { page, pageSize, sortBy, sortDir, ...filters } = q;
    res.json(await students.listStudents(filters as students.StudentFilters, { page, pageSize, sortBy, sortDir }));
  }),
);

studentsRouter.get(
  '/filters',
  asyncHandler(async (_req, res) => res.json(await students.getFilterOptions())),
);

studentsRouter.get(
  '/search',
  validateQuery(z.object({ q: z.string().min(1), limit: z.coerce.number().int().min(1).max(50).default(10) })),
  asyncHandler(async (req, res) => {
    const { q, limit } = parsedQuery<{ q: string; limit: number }>(req);
    res.json({ data: await students.quickSearch(q, limit) });
  }),
);

studentsRouter.post(
  '/compare',
  validateBody(z.object({ ids: z.array(z.string()).min(2).max(10) })),
  asyncHandler(async (req, res) => res.json({ data: await students.compareStudents(req.body.ids) })),
);

/** Refresh a selection, a whole batch, or everything. */
studentsRouter.post(
  '/refresh',
  requireTrainer,
  validateBody(
    z.object({
      studentIds: z.array(z.string()).optional(),
      batch: z.string().optional(),
      college: z.string().optional(),
      branch: z.string().optional(),
      section: z.string().optional(),
      platforms: z.array(platformEnum).optional(),
      force: z.boolean().default(false),
      scope: z.enum(['selected', 'batch', 'all', 'platform']).default('selected'),
    }),
  ),
  asyncHandler(async (req, res) => {
    const { studentIds, platforms, force, scope, ...filters } = req.body;
    if (scope === 'selected' && !studentIds?.length) throw badRequest('Select at least one student to refresh.');
    if (scope === 'batch' && !filters.batch) throw badRequest('A batch is required for a batch refresh.');

    const type = scope === 'all' ? 'REFRESH_ALL' : scope === 'batch' ? 'REFRESH_BATCH' : scope === 'platform' ? 'REFRESH_PLATFORM' : 'REFRESH_SELECTED';

    const job = await createProcessingJob({
      type,
      studentIds: scope === 'selected' ? studentIds : undefined,
      filters: scope === 'selected' ? undefined : filters,
      platforms: platforms as never,
      force,
      createdById: req.user!.sub,
    });
    res.status(202).json(job);
  }),
);

studentsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => res.json({ data: await students.getStudentDetail(req.params.id!) })),
);

studentsRouter.get(
  '/:id/platforms',
  asyncHandler(async (req, res) => {
    const student = await students.getStudentOrThrow(req.params.id!);
    res.json({
      data: student.profiles.map((p) => ({
        ...p,
        label: PLATFORMS[p.platform].label,
        color: PLATFORMS[p.platform].colors.light,
        colorDark: PLATFORMS[p.platform].colors.dark,
        profileUrl: p.profileUrl ?? PLATFORMS[p.platform].profileUrl(p.username),
        capabilities: {
          hasDifficultyBreakdown: PLATFORMS[p.platform].hasDifficultyBreakdown,
          hasContests: PLATFORMS[p.platform].hasContests,
          hasTopics: PLATFORMS[p.platform].hasTopics,
        },
      })),
    });
  }),
);

studentsRouter.get(
  '/:id/problems',
  validateQuery(
    z.object({
      platform: platformEnum.optional(),
      difficulty: z.enum(['EASY', 'MEDIUM', 'HARD', 'UNKNOWN']).optional(),
      topic: z.string().optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(200).default(50),
    }),
  ),
  asyncHandler(async (req, res) => {
    const q = parsedQuery<{ platform?: never; difficulty?: string; topic?: string; page: number; pageSize: number }>(req);
    res.json(await students.getStudentProblems(req.params.id!, q));
  }),
);

studentsRouter.get(
  '/:id/topics',
  validateQuery(z.object({ platform: platformEnum.optional() })),
  asyncHandler(async (req, res) => {
    const { platform } = parsedQuery<{ platform?: never }>(req);
    res.json({ data: await students.getStudentTopics(req.params.id!, platform) });
  }),
);

studentsRouter.get(
  '/:id/contests',
  validateQuery(z.object({ platform: platformEnum.optional() })),
  asyncHandler(async (req, res) => {
    const { platform } = parsedQuery<{ platform?: never }>(req);
    res.json(await students.getStudentContests(req.params.id!, platform));
  }),
);

studentsRouter.get(
  '/:id/ratings',
  validateQuery(z.object({ platform: platformEnum.optional() })),
  asyncHandler(async (req, res) => {
    const { platform } = parsedQuery<{ platform?: never }>(req);
    res.json(await students.getStudentRatings(req.params.id!, platform));
  }),
);

studentsRouter.get(
  '/:id/history',
  validateQuery(z.object({ platform: platformEnum.optional(), days: z.coerce.number().int().min(7).max(1095).default(180) })),
  asyncHandler(async (req, res) => {
    const { platform, days } = parsedQuery<{ platform?: never; days: number }>(req);
    res.json({ data: await students.getStudentHistory(req.params.id!, platform, days) });
  }),
);

studentsRouter.get(
  '/:id/analytics',
  asyncHandler(async (req, res) => {
    const student = await students.getStudentOrThrow(req.params.id!);
    const skills = await prisma.studentSkill.findMany({ where: { studentId: student.id }, orderBy: { score: 'desc' } });
    if (!student.analytics) throw notFound('Analytics have not been computed for this student yet');
    res.json({ data: { ...student.analytics, skills } });
  }),
);

/** Preview the score under different weights without persisting them. */
studentsRouter.post(
  '/:id/score-preview',
  validateBody(
    z.object({
      problemsSolved: z.number().min(0).max(100).optional(),
      problemDifficulty: z.number().min(0).max(100).optional(),
      contestParticipation: z.number().min(0).max(100).optional(),
      contestRating: z.number().min(0).max(100).optional(),
      topicCoverage: z.number().min(0).max(100).optional(),
    }),
  ),
  asyncHandler(async (req, res) => res.json({ data: await students.previewScore(req.params.id!, req.body) })),
);

studentsRouter.post(
  '/:id/refresh',
  requireTrainer,
  validateBody(z.object({ platforms: z.array(platformEnum).optional(), force: z.boolean().default(true) })),
  asyncHandler(async (req, res) => {
    const student = await students.getStudentOrThrow(req.params.id!);
    const job = await createProcessingJob({
      type: 'REFRESH_SELECTED',
      studentIds: [student.id],
      platforms: req.body.platforms,
      force: req.body.force,
      createdById: req.user!.sub,
    });
    res.status(202).json(job);
  }),
);

studentsRouter.patch(
  '/:id',
  requireTrainer,
  validateBody(
    z.object({
      name: z.string().min(1).max(200).optional(),
      email: z.string().email().nullable().optional(),
      phone: z.string().max(40).nullable().optional(),
      university: z.string().max(200).nullable().optional(),
      college: z.string().max(200).nullable().optional(),
      batch: z.string().max(50).nullable().optional(),
      branch: z.string().max(100).nullable().optional(),
      section: z.string().max(50).nullable().optional(),
      isActive: z.boolean().optional(),
      notes: z.string().max(2000).nullable().optional(),
      handles: z.record(platformEnum, z.string().max(200).nullable()).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const student = await students.getStudentOrThrow(req.params.id!);
    const { handles, ...fields } = req.body;

    await prisma.student.update({ where: { id: student.id }, data: fields });

    if (handles) {
      for (const [platform, raw] of Object.entries(handles) as [never, string | null][]) {
        if (raw === null || raw.trim() === '') {
          await prisma.platformProfile.deleteMany({ where: { studentId: student.id, platform } });
          await invalidateCache(platform);
          continue;
        }
        await prisma.platformProfile.upsert({
          where: { studentId_platform: { studentId: student.id, platform } },
          create: { studentId: student.id, platform, username: raw.trim(), status: 'PENDING' },
          update: { username: raw.trim(), status: 'PENDING', statusMessage: null },
        });
      }
      await recomputeStudentAnalytics(student.id);
    }

    res.json({ data: await students.getStudentDetail(student.id) });
  }),
);

studentsRouter.delete(
  '/:id',
  requireTrainer,
  asyncHandler(async (req, res) => {
    const student = await students.getStudentOrThrow(req.params.id!);
    await prisma.student.delete({ where: { id: student.id } });
    res.status(204).end();
  }),
);
