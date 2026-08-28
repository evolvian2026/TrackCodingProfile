import { prisma } from '../db/prisma.js';
import { logger } from '../lib/logger.js';
import { getRefreshSchedule } from './settings.service.js';
import { createProcessingJob } from './processing.service.js';
import { describeSchedule, dueSlot, nextOccurrence, previousOccurrence } from './schedule.service.js';

/** How often the loop wakes up to ask whether a slot is due. */
const TICK_MS = 60_000;

let timer: NodeJS.Timeout | null = null;
let ticking = false;

/**
 * Attempts to run whichever scheduled slot is currently due.
 *
 * Claiming works by inserting a row keyed on the slot instant: the unique
 * constraint means exactly one worker wins, however many are running, and a
 * restart cannot re-fire a slot that already went. Exported so the tests (and
 * the "run now" endpoint) can drive one tick deterministically.
 */
export async function runDueSlot(now = new Date()): Promise<
  { ran: false; reason: string } | { ran: true; jobId: string; jobNumber: number; scheduledFor: Date }
> {
  const schedule = await getRefreshSchedule();
  if (!schedule.enabled) return { ran: false, reason: 'Automatic refresh is disabled' };

  const due = dueSlot(schedule, now);
  if (!due) return { ran: false, reason: 'Schedule produced no occurrence (check the time zone)' };

  const existing = await prisma.scheduledRun.findUnique({ where: { scheduledFor: due.scheduledFor } });
  if (existing) return { ran: false, reason: `Slot ${due.scheduledFor.toISOString()} already handled` };

  // Insert-to-claim. A concurrent worker racing us loses on the unique index.
  let claimed;
  try {
    claimed = await prisma.scheduledRun.create({ data: { scheduledFor: due.scheduledFor, status: 'CLAIMED' } });
  } catch {
    return { ran: false, reason: 'Another worker claimed this slot' };
  }

  // Missed by more than the grace window: record it, do not surprise anyone
  // with a full refresh hours late.
  if (!due.withinGrace) {
    await prisma.scheduledRun.update({
      where: { id: claimed.id },
      data: {
        status: 'SKIPPED',
        finishedAt: new Date(),
        note: `Missed by ${due.lateByMinutes} minutes, beyond the ${schedule.graceMinutes}-minute grace window`,
      },
    });
    logger.warn(`Scheduled refresh slot ${due.scheduledFor.toISOString()} skipped — missed by ${due.lateByMinutes}m`);
    return { ran: false, reason: 'Slot missed by more than the grace window' };
  }

  try {
    const job = await createProcessingJob({ type: 'REFRESH_ALL', force: schedule.force });
    await prisma.scheduledRun.update({
      where: { id: claimed.id },
      data: { status: 'STARTED', jobId: job.jobId, note: `Queued ${job.totalItems} profile fetches` },
    });
    logger.info(`Scheduled refresh started job #${job.number} (${job.totalItems} items)`);
    return { ran: true, jobId: job.jobId, jobNumber: job.number, scheduledFor: due.scheduledFor };
  } catch (err) {
    const message = (err as Error).message;
    // "Nothing to do" is a normal outcome, not a failure: an unforced refresh
    // right after a manual one legitimately finds everything still fresh.
    const nothingToDo = /cache window|no platform handles|nothing to process/i.test(message);
    await prisma.scheduledRun.update({
      where: { id: claimed.id },
      data: { status: nothingToDo ? 'COMPLETED' : 'FAILED', finishedAt: new Date(), note: message.slice(0, 500) },
    });
    if (!nothingToDo) logger.error('Scheduled refresh failed to start', message);
    return { ran: false, reason: message };
  }
}

/**
 * Starts a refresh immediately, outside the schedule.
 *
 * This is deliberately not `runDueSlot`: the due slot is claimed at most once,
 * so once today's slot has run a "Run now" button routed through it would do
 * nothing for the rest of the day. An ad-hoc run is keyed on the instant it was
 * requested, which no schedule slot can collide with, so it always starts and
 * still leaves a row in the same audit trail. It runs whether or not automatic
 * refresh is enabled — someone pressed the button.
 */
export async function runNow(now = new Date()): Promise<
  { ran: false; reason: string } | { ran: true; jobId: string; jobNumber: number; scheduledFor: Date }
> {
  const schedule = await getRefreshSchedule();
  const claimed = await prisma.scheduledRun.create({
    data: { scheduledFor: now, status: 'CLAIMED', trigger: 'MANUAL', note: 'Started manually' },
  });

  try {
    const job = await createProcessingJob({ type: 'REFRESH_ALL', force: schedule.force });
    await prisma.scheduledRun.update({
      where: { id: claimed.id },
      data: { status: 'STARTED', jobId: job.jobId, note: `Queued ${job.totalItems} profile fetches` },
    });
    logger.info(`Manual refresh started job #${job.number} (${job.totalItems} items)`);
    return { ran: true, jobId: job.jobId, jobNumber: job.number, scheduledFor: claimed.scheduledFor };
  } catch (err) {
    const message = (err as Error).message;
    const nothingToDo = /cache window|no platform handles|nothing to process/i.test(message);
    await prisma.scheduledRun.update({
      where: { id: claimed.id },
      data: {
        status: nothingToDo ? 'COMPLETED' : 'FAILED',
        finishedAt: new Date(),
        note: message.slice(0, 500),
      },
    });
    if (!nothingToDo) logger.error('Manual refresh failed to start', message);
    return { ran: false, reason: message };
  }
}

/** Starts the background loop. Safe to call once per process. */
export function startScheduler(): void {
  if (timer) return;

  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      await runDueSlot();
    } catch (err) {
      logger.error('Scheduler tick failed', (err as Error).message);
    } finally {
      ticking = false;
    }
  };

  timer = setInterval(() => void tick(), TICK_MS);
  // Do not hold the process open just for the scheduler.
  timer.unref?.();
  void tick();

  logger.info('Refresh scheduler started');
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

export interface ScheduleStatus {
  schedule: Awaited<ReturnType<typeof getRefreshSchedule>>;
  description: string;
  nextRunAt: string | null;
  previousRunAt: string | null;
  recentRuns: {
    id: string;
    scheduledFor: Date;
    status: string;
    trigger: string;
    note: string | null;
    jobId: string | null;
    jobNumber: number | null;
    claimedAt: Date;
    finishedAt: Date | null;
  }[];
}

export async function getScheduleStatus(now = new Date()): Promise<ScheduleStatus> {
  const schedule = await getRefreshSchedule();

  const runs = await prisma.scheduledRun.findMany({ orderBy: { scheduledFor: 'desc' }, take: 10 });
  const jobIds = runs.map((r) => r.jobId).filter((id): id is string => Boolean(id));
  const jobs = jobIds.length
    ? await prisma.processingJob.findMany({ where: { id: { in: jobIds } }, select: { id: true, number: true } })
    : [];
  const numberById = new Map(jobs.map((j) => [j.id, j.number]));

  return {
    schedule,
    description: describeSchedule(schedule),
    nextRunAt: nextOccurrence(schedule, now)?.toISOString() ?? null,
    previousRunAt: previousOccurrence(schedule, now)?.toISOString() ?? null,
    recentRuns: runs.map((run) => ({
      id: run.id,
      scheduledFor: run.scheduledFor,
      status: run.status,
      trigger: run.trigger,
      note: run.note,
      jobId: run.jobId,
      jobNumber: run.jobId ? (numberById.get(run.jobId) ?? null) : null,
      claimedAt: run.claimedAt,
      finishedAt: run.finishedAt,
    })),
  };
}
