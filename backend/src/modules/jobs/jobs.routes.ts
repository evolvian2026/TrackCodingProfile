import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { PLATFORMS } from '../../config/platforms.js';
import { asyncHandler } from '../../middleware/error.js';
import { requireAuth, requireTrainer } from '../../middleware/auth.js';
import { parsedQuery, validateQuery } from '../../middleware/validate.js';
import { getQueue } from '../../queue/index.js';
import { cancelJob, getJobProgress, retryFailedItems } from '../../services/processing.service.js';

export const jobsRouter = Router();
jobsRouter.use(requireAuth);

jobsRouter.get(
  '/',
  validateQuery(
    z.object({
      status: z.string().optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(20),
    }),
  ),
  asyncHandler(async (req, res) => {
    const { status, page, pageSize } = parsedQuery<{ status?: string; page: number; pageSize: number }>(req);
    const where = status ? { status: status as never } : {};
    const [total, jobs] = await Promise.all([
      prisma.processingJob.count({ where }),
      prisma.processingJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { createdBy: { select: { name: true } }, uploadBatch: { select: { originalName: true } } },
      }),
    ]);

    res.json({
      data: jobs.map((job) => ({
        ...job,
        percentage: job.totalItems > 0 ? Math.round((job.processed / job.totalItems) * 1000) / 10 : 0,
      })),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  }),
);

/** Live queue depth — used by the processing dashboard header. */
jobsRouter.get(
  '/queue-status',
  asyncHandler(async (_req, res) => {
    const queue = getQueue();
    res.json({ driver: queue.name, ...(await queue.stats()) });
  }),
);

jobsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => res.json({ data: await getJobProgress(req.params.id!) })),
);

/** Per-item detail for the error dashboard. */
jobsRouter.get(
  '/:id/items',
  validateQuery(
    z.object({
      status: z.string().optional(),
      platform: z.string().optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(200).default(50),
    }),
  ),
  asyncHandler(async (req, res) => {
    const { status, platform, page, pageSize } = parsedQuery<{ status?: string; platform?: string; page: number; pageSize: number }>(req);
    const where = {
      jobId: req.params.id!,
      ...(status ? { status: status as never } : {}),
      ...(platform ? { platform: platform as never } : {}),
    };

    const [total, items] = await Promise.all([
      prisma.processingJobItem.count({ where }),
      prisma.processingJobItem.findMany({
        where,
        orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { student: { select: { id: true, studentId: true, name: true } } },
      }),
    ]);

    res.json({
      data: items.map((item) => ({
        id: item.id,
        student: item.student,
        platform: item.platform,
        platformLabel: PLATFORMS[item.platform].label,
        status: item.status,
        dataStatus: item.dataStatus,
        attempts: item.attempts,
        error: item.lastError,
        durationMs: item.durationMs,
        lastAttempt: item.finishedAt ?? item.startedAt,
      })),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  }),
);

jobsRouter.post(
  '/:id/retry',
  requireTrainer,
  asyncHandler(async (req, res) => res.status(202).json(await retryFailedItems(req.params.id!))),
);

jobsRouter.post(
  '/:id/cancel',
  requireTrainer,
  asyncHandler(async (req, res) => {
    await cancelJob(req.params.id!);
    res.status(202).json({ message: 'Job cancelled. Items already in flight will finish.' });
  }),
);

/** Failures across every job, for the standalone error dashboard. */
jobsRouter.get(
  '/errors/recent',
  validateQuery(
    z.object({
      platform: z.string().optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(200).default(50),
    }),
  ),
  asyncHandler(async (req, res) => {
    const { platform, page, pageSize } = parsedQuery<{ platform?: string; page: number; pageSize: number }>(req);
    const where = platform ? { platform: platform as never } : {};

    const [total, errors] = await Promise.all([
      prisma.platformError.count({ where }),
      prisma.platformError.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { student: { select: { id: true, studentId: true, name: true } }, job: { select: { number: true } } },
      }),
    ]);

    res.json({ data: errors, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
  }),
);
