import type { JobType, Platform, Prisma, Student } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { logger } from '../lib/logger.js';
import { ALL_PLATFORMS, PLATFORMS } from '../config/platforms.js';
import { badRequest, notFound } from '../lib/errors.js';
import { getAdapter } from '../platforms/registry.js';
import { isRetryableStatus } from '../platforms/types.js';
import { getQueue, type FetchJobPayload } from '../queue/index.js';
import { getCacheSettings, getProcessingLimits } from './settings.service.js';
import { ingestSnapshot } from './ingest.service.js';
import { recomputeStudentAnalytics } from './analytics.service.js';

export interface CreateJobInput {
  type: JobType;
  studentIds?: string[];
  /** Filters used when studentIds is omitted. */
  filters?: { batch?: string; college?: string; branch?: string; section?: string };
  platforms?: Platform[];
  force?: boolean;
  createdById?: string | null;
  uploadBatchId?: string | null;
}

export interface JobCreationResult {
  jobId: string;
  number: number;
  totalStudents: number;
  totalItems: number;
  skippedFresh: number;
}

/**
 * Creates a processing job: one job item per (student, platform) pair that has
 * a handle. Items are the unit of retry, so one platform failing for one
 * student never blocks the other 3,999 items.
 */
export async function createProcessingJob(input: CreateJobInput): Promise<JobCreationResult> {
  const platforms = input.platforms?.length ? input.platforms : ALL_PLATFORMS;

  const students = await selectStudents(input);
  if (students.length === 0) throw badRequest('No students matched the selection, so there is nothing to process.');

  const profiles = await prisma.platformProfile.findMany({
    where: { studentId: { in: students.map((s) => s.id) }, platform: { in: platforms } },
    select: { studentId: true, platform: true, username: true, lastSuccessAt: true },
  });

  const cache = await getCacheSettings();
  const freshBefore = new Date(Date.now() - cache.ttlMinutes * 60_000);

  const items: { studentId: string; platform: Platform; username: string }[] = [];
  let skippedFresh = 0;

  for (const profile of profiles) {
    if (!profile.username) continue;
    // Honour the cache window unless the administrator explicitly forced a refresh.
    if (!input.force && profile.lastSuccessAt && profile.lastSuccessAt > freshBefore) {
      skippedFresh += 1;
      continue;
    }
    items.push({ studentId: profile.studentId, platform: profile.platform, username: profile.username });
  }

  if (items.length === 0) {
    throw badRequest(
      skippedFresh > 0
        ? `All ${skippedFresh} matching profiles are still within the ${cache.ttlMinutes}-minute cache window. Use "force refresh" to fetch them anyway.`
        : 'The selected students have no platform handles to fetch.',
    );
  }

  const studentIdsWithWork = new Set(items.map((i) => i.studentId));

  const job = await prisma.processingJob.create({
    data: {
      type: input.type,
      status: 'QUEUED',
      platforms,
      totalStudents: studentIdsWithWork.size,
      totalItems: items.length,
      forceRefresh: Boolean(input.force),
      createdById: input.createdById ?? null,
      uploadBatchId: input.uploadBatchId ?? null,
      options: { skippedFresh, filters: input.filters ?? null } as Prisma.InputJsonValue,
      items: {
        createMany: {
          data: items.map((i) => ({ studentId: i.studentId, platform: i.platform })),
          skipDuplicates: true,
        },
      },
    },
    select: { id: true, number: true },
  });

  const created = await prisma.processingJobItem.findMany({
    where: { jobId: job.id },
    select: { id: true, studentId: true, platform: true },
  });
  const usernameByKey = new Map(items.map((i) => [`${i.studentId}:${i.platform}`, i.username]));

  const payloads: FetchJobPayload[] = created.map((item) => ({
    jobId: job.id,
    itemId: item.id,
    studentId: item.studentId,
    platform: item.platform,
    username: usernameByKey.get(`${item.studentId}:${item.platform}`) ?? '',
    force: Boolean(input.force),
  }));

  await prisma.processingJob.update({
    where: { id: job.id },
    data: { status: 'RUNNING', startedAt: new Date() },
  });
  await getQueue().enqueueMany(payloads);

  logger.info(`Processing job #${job.number} queued: ${payloads.length} items across ${studentIdsWithWork.size} students`);
  return { jobId: job.id, number: job.number, totalStudents: studentIdsWithWork.size, totalItems: payloads.length, skippedFresh };
}

async function selectStudents(input: CreateJobInput): Promise<Pick<Student, 'id'>[]> {
  if (input.studentIds?.length) {
    return prisma.student.findMany({ where: { id: { in: input.studentIds } }, select: { id: true } });
  }
  const f = input.filters ?? {};
  return prisma.student.findMany({
    where: {
      isActive: true,
      ...(f.batch ? { batch: f.batch } : {}),
      ...(f.college ? { college: f.college } : {}),
      ...(f.branch ? { branch: f.branch } : {}),
      ...(f.section ? { section: f.section } : {}),
    },
    select: { id: true },
  });
}

/**
 * Processes a single (student, platform) item. This is the function the queue
 * worker calls; it is deliberately self-contained and never throws, so a bad
 * item can never take the worker down.
 */
export async function processJobItem(payload: FetchJobPayload): Promise<void> {
  const startedAt = new Date();

  const job = await prisma.processingJob.findUnique({ where: { id: payload.jobId }, select: { status: true } });
  if (!job || job.status === 'CANCELLED') {
    await prisma.processingJobItem.update({
      where: { id: payload.itemId },
      data: { status: 'SKIPPED', finishedAt: new Date(), lastError: 'Job was cancelled' },
    }).catch(() => undefined);
    return;
  }

  const student = await prisma.student.findUnique({ where: { id: payload.studentId }, select: { name: true } });

  await prisma.processingJobItem.update({
    where: { id: payload.itemId },
    data: { status: 'RUNNING', startedAt, attempts: { increment: 1 } },
  });
  await prisma.processingJob.update({
    where: { id: payload.jobId },
    data: { currentStudent: student?.name ?? null },
  }).catch(() => undefined);

  try {
    const adapter = getAdapter(payload.platform);
    const snapshot = await adapter.fetchAll(payload.username, { force: payload.force });
    const outcome = await ingestSnapshot(payload.studentId, snapshot, { jobId: payload.jobId });

    const itemStatus =
      outcome.status === 'AVAILABLE' ? 'COMPLETED' : outcome.status === 'RATE_LIMITED' ? 'RATE_LIMITED' : 'FAILED';

    await prisma.processingJobItem.update({
      where: { id: payload.itemId },
      data: {
        status: itemStatus,
        dataStatus: outcome.status,
        lastError: outcome.status === 'AVAILABLE' ? null : (outcome.message ?? 'Data unavailable'),
        finishedAt: new Date(),
        durationMs: Date.now() - startedAt.getTime(),
      },
    });

    await bumpCounters(payload.jobId, itemStatus);
  } catch (err) {
    logger.error(`Job item ${payload.itemId} failed unexpectedly`, (err as Error).message);
    await prisma.processingJobItem.update({
      where: { id: payload.itemId },
      data: {
        status: 'FAILED',
        dataStatus: 'ERROR',
        lastError: (err as Error).message.slice(0, 500),
        finishedAt: new Date(),
        durationMs: Date.now() - startedAt.getTime(),
      },
    }).catch(() => undefined);
    await bumpCounters(payload.jobId, 'FAILED');
  }

  await finalizeStudentIfDone(payload.jobId, payload.studentId);
  await finalizeJobIfDone(payload.jobId);
}

async function bumpCounters(jobId: string, status: 'COMPLETED' | 'FAILED' | 'RATE_LIMITED' | 'SKIPPED') {
  const field =
    status === 'COMPLETED' ? 'successful' : status === 'RATE_LIMITED' ? 'rateLimited' : status === 'SKIPPED' ? 'skipped' : 'failed';
  await prisma.processingJob
    .update({ where: { id: jobId }, data: { processed: { increment: 1 }, [field]: { increment: 1 } } })
    .catch((err) => logger.warn('Failed to update job counters', (err as Error).message));
}

/** Once every platform for a student has settled, refresh their analytics. */
async function finalizeStudentIfDone(jobId: string, studentId: string): Promise<void> {
  const pending = await prisma.processingJobItem.count({
    where: { jobId, studentId, status: { in: ['PENDING', 'RUNNING'] } },
  });
  if (pending > 0) return;
  await recomputeStudentAnalytics(studentId).catch((err) =>
    logger.warn(`Analytics recompute failed for ${studentId}`, (err as Error).message),
  );
}

async function finalizeJobIfDone(jobId: string): Promise<void> {
  const pending = await prisma.processingJobItem.count({ where: { jobId, status: { in: ['PENDING', 'RUNNING'] } } });
  if (pending > 0) return;

  const job = await prisma.processingJob.findUnique({ where: { id: jobId }, select: { status: true, failed: true, rateLimited: true } });
  if (!job || ['COMPLETED', 'COMPLETED_WITH_ERRORS', 'CANCELLED', 'FAILED'].includes(job.status)) return;

  await prisma.processingJob.update({
    where: { id: jobId },
    data: {
      status: job.failed + job.rateLimited > 0 ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED',
      finishedAt: new Date(),
      currentStudent: null,
    },
  });
  logger.info(`Processing job ${jobId} finished`);
}

/** Re-queues every failed or rate-limited item on a job. */
export async function retryFailedItems(jobId: string): Promise<{ requeued: number }> {
  const job = await prisma.processingJob.findUnique({ where: { id: jobId } });
  if (!job) throw notFound('Processing job not found');

  const limits = await getProcessingLimits();
  const items = await prisma.processingJobItem.findMany({
    where: { jobId, status: { in: ['FAILED', 'RATE_LIMITED'] } },
    include: { student: { select: { profiles: { select: { platform: true, username: true } } } } },
  });

  const retryable = items.filter((item) => {
    if (item.attempts >= limits.maxRetries + 1) {
      // A permanently missing profile is not worth another request.
      return item.dataStatus ? isRetryableStatus(item.dataStatus) : false;
    }
    return true;
  });

  if (retryable.length === 0) return { requeued: 0 };

  await prisma.processingJobItem.updateMany({
    where: { id: { in: retryable.map((i) => i.id) } },
    data: { status: 'PENDING', lastError: null, finishedAt: null },
  });

  await prisma.processingJob.update({
    where: { id: jobId },
    data: {
      status: 'RUNNING',
      finishedAt: null,
      // Counters are reduced by what we are about to re-run so progress stays honest.
      processed: { decrement: retryable.length },
      failed: { decrement: retryable.filter((i) => i.status === 'FAILED').length },
      rateLimited: { decrement: retryable.filter((i) => i.status === 'RATE_LIMITED').length },
    },
  });

  const payloads: FetchJobPayload[] = retryable.map((item) => ({
    jobId,
    itemId: item.id,
    studentId: item.studentId,
    platform: item.platform,
    username: item.student.profiles.find((p) => p.platform === item.platform)?.username ?? '',
    force: true,
  }));
  await getQueue().enqueueMany(payloads);

  return { requeued: payloads.length };
}

export async function cancelJob(jobId: string): Promise<void> {
  await getQueue().cancel(jobId);
  await prisma.$transaction([
    prisma.processingJobItem.updateMany({
      where: { jobId, status: 'PENDING' },
      data: { status: 'SKIPPED', lastError: 'Cancelled by administrator', finishedAt: new Date() },
    }),
    prisma.processingJob.update({
      where: { id: jobId },
      data: { status: 'CANCELLED', finishedAt: new Date(), currentStudent: null },
    }),
  ]);
}

/**
 * Re-queues work that was in flight when the process stopped. Called at boot so
 * a restart mid-job does not strand students in RUNNING forever.
 */
export async function resumeInterruptedJobs(): Promise<number> {
  const stuck = await prisma.processingJobItem.findMany({
    where: { status: { in: ['PENDING', 'RUNNING'] }, job: { status: { in: ['QUEUED', 'RUNNING'] } } },
    include: { student: { select: { profiles: { select: { platform: true, username: true } } } } },
    take: 50_000,
  });
  if (stuck.length === 0) return 0;

  await prisma.processingJobItem.updateMany({
    where: { id: { in: stuck.map((i) => i.id) } },
    data: { status: 'PENDING', startedAt: null },
  });

  await getQueue().enqueueMany(
    stuck.map((item) => ({
      jobId: item.jobId,
      itemId: item.id,
      studentId: item.studentId,
      platform: item.platform,
      username: item.student.profiles.find((p) => p.platform === item.platform)?.username ?? '',
      force: false,
    })),
  );

  logger.info(`Resumed ${stuck.length} interrupted job items`);
  return stuck.length;
}

export interface JobProgress {
  id: string;
  number: number;
  type: JobType;
  status: string;
  totalStudents: number;
  totalItems: number;
  processed: number;
  successful: number;
  failed: number;
  rateLimited: number;
  skipped: number;
  pending: number;
  percentage: number;
  currentStudent: string | null;
  studentsProcessed: number;
  studentsRemaining: number;
  platformStatus: {
    platform: Platform;
    label: string;
    color: string;
    total: number;
    successful: number;
    failed: number;
    rateLimited: number;
    pending: number;
  }[];
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  error: string | null;
}

/** Everything the processing dashboard needs, in two aggregate queries. */
export async function getJobProgress(jobId: string): Promise<JobProgress> {
  const job = await prisma.processingJob.findUnique({ where: { id: jobId } });
  if (!job) throw notFound('Processing job not found');

  const [byPlatform, studentsDone] = await Promise.all([
    prisma.processingJobItem.groupBy({ by: ['platform', 'status'], where: { jobId }, _count: { _all: true } }),
    prisma.processingJobItem
      .findMany({ where: { jobId, status: { in: ['PENDING', 'RUNNING'] } }, select: { studentId: true }, distinct: ['studentId'] })
      .then((rows) => job.totalStudents - rows.length),
  ]);

  const platformStatus = job.platforms.map((platform) => {
    const rows = byPlatform.filter((r) => r.platform === platform);
    const countFor = (status: string) => rows.find((r) => r.status === status)?._count._all ?? 0;
    return {
      platform,
      label: PLATFORMS[platform].label,
      color: PLATFORMS[platform].color,
      total: rows.reduce((sum, r) => sum + r._count._all, 0),
      successful: countFor('COMPLETED'),
      failed: countFor('FAILED'),
      rateLimited: countFor('RATE_LIMITED'),
      pending: countFor('PENDING') + countFor('RUNNING'),
    };
  });

  const pending = Math.max(0, job.totalItems - job.processed);

  return {
    id: job.id,
    number: job.number,
    type: job.type,
    status: job.status,
    totalStudents: job.totalStudents,
    totalItems: job.totalItems,
    processed: job.processed,
    successful: job.successful,
    failed: job.failed,
    rateLimited: job.rateLimited,
    skipped: job.skipped,
    pending,
    percentage: job.totalItems > 0 ? Math.round((job.processed / job.totalItems) * 1000) / 10 : 0,
    currentStudent: job.currentStudent,
    studentsProcessed: studentsDone,
    studentsRemaining: Math.max(0, job.totalStudents - studentsDone),
    platformStatus,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    createdAt: job.createdAt,
    error: job.error,
  };
}
