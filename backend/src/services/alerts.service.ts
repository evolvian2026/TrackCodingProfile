import type { AlertSeverity, AlertType, Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { logger } from '../lib/logger.js';
import { PLATFORMS } from '../config/platforms.js';
import { getAlertRules } from './settings.service.js';
import type { AlertRules } from '../config/defaults.js';

export const ALERT_TYPES = [
  'NO_PROGRESS',
  'RATING_DECLINE',
  'CONTEST_INACTIVE',
  'NO_DATA',
  'PROFILE_UNAVAILABLE',
  'NO_PLATFORM_HANDLES',
  'STALE_DATA',
] as const;

export const ALERT_LABELS: Record<AlertType, string> = {
  NO_PROGRESS: 'No progress',
  RATING_DECLINE: 'Rating declining',
  CONTEST_INACTIVE: 'Not entering contests',
  NO_DATA: 'No data retrieved',
  PROFILE_UNAVAILABLE: 'Handle looks wrong',
  NO_PLATFORM_HANDLES: 'No handles on file',
  STALE_DATA: 'Data too old to judge',
};

/** Statuses that mean the stored handle is probably wrong, not merely absent. */
const BROKEN_STATUSES = new Set(['NOT_FOUND', 'PRIVATE', 'ERROR']);

interface Candidate {
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  evidence: Record<string, unknown>;
}

const DAY_MS = 86_400_000;
const daysBetween = (a: Date, b: Date) => Math.round(Math.abs(a.getTime() - b.getTime()) / DAY_MS);

/**
 * Decides which concerns apply to one student.
 *
 * Kept pure and exported so the rules can be tested directly, without a
 * database and without inventing snapshot fixtures through the whole pipeline.
 */
export function evaluateRules(input: {
  rules: AlertRules;
  now: Date;
  hasHandles: boolean;
  /** Profiles that have ever returned data. */
  availableProfiles: number;
  brokenProfiles: { platform: string; status: string; lastSuccessAt: Date | null }[];
  /** Most recent successful fetch across every platform. */
  lastSuccessAt: Date | null;
  /** Aggregate snapshots, oldest first. */
  snapshots: { capturedAt: Date; totalSolved: number | null; rating: number | null; contestsAttended: number | null }[];
  /** Whether any platform with data publishes contest participation. */
  contestsKnown: boolean;
}): Candidate[] {
  const { rules, now } = input;
  const out: Candidate[] = [];

  if (!rules.enabled) return out;

  // -- nothing to fetch ----------------------------------------------------
  if (!input.hasHandles) {
    return [
      {
        type: 'NO_PLATFORM_HANDLES',
        severity: 'INFO',
        message: 'No coding profile handles are on file, so nothing can be fetched for this student.',
        evidence: {},
      },
    ];
  }

  // -- a handle that keeps failing -----------------------------------------
  const persistentlyBroken = input.brokenProfiles.filter(
    (p) => p.lastSuccessAt === null || daysBetween(now, p.lastSuccessAt) >= rules.brokenProfileDays,
  );
  if (persistentlyBroken.length > 0) {
    const names = persistentlyBroken.map((p) => `${PLATFORMS[p.platform as keyof typeof PLATFORMS]?.label ?? p.platform} (${p.status.toLowerCase().replace('_', ' ')})`);
    out.push({
      type: 'PROFILE_UNAVAILABLE',
      severity: 'WARNING',
      message: `${names.join(', ')} — the stored handle is probably wrong or the profile is private.`,
      evidence: { profiles: persistentlyBroken.map((p) => ({ platform: p.platform, status: p.status, lastSuccessAt: p.lastSuccessAt })) },
    });
  }

  // -- never returned anything ---------------------------------------------
  if (input.availableProfiles === 0) {
    out.push({
      type: 'NO_DATA',
      severity: 'WARNING',
      message: 'Handles are on file but no platform has returned data for this student yet.',
      evidence: { linkedProfiles: input.brokenProfiles.length },
    });
    return out;
  }

  // -- can we judge activity at all? ---------------------------------------
  // This guard is the point of the whole feature: a student must never be
  // flagged as inactive because WE stopped collecting data.
  const staleDays = input.lastSuccessAt ? daysBetween(now, input.lastSuccessAt) : Number.POSITIVE_INFINITY;
  if (staleDays >= rules.staleDataDays) {
    out.push({
      type: 'STALE_DATA',
      severity: 'INFO',
      message: `Last successful fetch was ${Number.isFinite(staleDays) ? `${staleDays} days ago` : 'never'} — too old to judge activity. Refresh before drawing conclusions.`,
      evidence: { lastSuccessAt: input.lastSuccessAt, staleDays: Number.isFinite(staleDays) ? staleDays : null },
    });
    return out;
  }

  // -- progress over the window --------------------------------------------
  //
  // "Did they move in the last N days" needs a reading from N days ago and a
  // reading from now. Filtering snapshots down to the window would throw the
  // older reading away and leave nothing to compare against, so the baseline is
  // the most recent observation at or BEFORE the window opened.
  const windowStart = new Date(now.getTime() - rules.inactivityDays * DAY_MS);

  const baselineFor = (
    field: 'totalSolved' | 'contestsAttended',
    windowDays: number,
  ): { from: (typeof input.snapshots)[number]; to: (typeof input.snapshots)[number]; spanDays: number } | null => {
    const points = input.snapshots.filter((s) => s[field] !== null);
    const to = points[points.length - 1];
    if (!to) return null;

    const start = new Date(now.getTime() - windowDays * DAY_MS);
    const priorPoints = points.filter((s) => s.capturedAt <= start);
    const from = priorPoints[priorPoints.length - 1];
    // No reading from before the window opened means we have not been watching
    // long enough to say anything.
    if (!from || from === to) return null;

    return { from, to, spanDays: daysBetween(to.capturedAt, from.capturedAt) };
  };

  const solvedSpan = baselineFor('totalSolved', rules.inactivityDays);
  if (solvedSpan) {
    const gained = (solvedSpan.to.totalSolved ?? 0) - (solvedSpan.from.totalSolved ?? 0);
    if (gained <= rules.minProgressSolved) {
      out.push({
        type: 'NO_PROGRESS',
        severity: 'WARNING',
        message: `Solved count moved by ${gained} in ${solvedSpan.spanDays} days (${solvedSpan.from.totalSolved} → ${solvedSpan.to.totalSolved}).`,
        evidence: {
          from: { date: solvedSpan.from.capturedAt, totalSolved: solvedSpan.from.totalSolved },
          to: { date: solvedSpan.to.capturedAt, totalSolved: solvedSpan.to.totalSolved },
          gained,
          windowDays: solvedSpan.spanDays,
        },
      });
    }
  }

  // -- contest participation ------------------------------------------------
  if (input.contestsKnown && rules.contestInactivityDays > 0) {
    const contestSpan = baselineFor('contestsAttended', rules.contestInactivityDays);
    if (contestSpan && (contestSpan.to.contestsAttended ?? 0) - (contestSpan.from.contestsAttended ?? 0) <= 0) {
      out.push({
        type: 'CONTEST_INACTIVE',
        severity: 'INFO',
        message: `No new contest in ${contestSpan.spanDays} days (still ${contestSpan.to.contestsAttended}).`,
        evidence: {
          contestsAttended: contestSpan.to.contestsAttended,
          windowDays: contestSpan.spanDays,
          since: contestSpan.from.capturedAt,
        },
      });
    }
  }

  // -- rating decline -------------------------------------------------------
  //
  // Measured from the peak since the window opened, not an all-time high: a
  // dip from a personal best two years ago is not news.
  const ratingPoints = input.snapshots.filter((s) => s.rating !== null);
  const latestRating = ratingPoints[ratingPoints.length - 1];
  if (latestRating) {
    // Snapshots can be sparse — a weekly refresh may leave only one reading
    // inside a 21-day window — so the observation immediately before the window
    // is allowed in as well. It is NOT allowed in if it is ancient: reaching
    // back a year would turn "down from a personal best in 2024" into a
    // decline alert today. Twice the window is the limit.
    const oldestUsable = new Date(now.getTime() - rules.inactivityDays * 2 * DAY_MS);
    const priorRatings = ratingPoints.filter((s) => s.capturedAt <= windowStart && s.capturedAt >= oldestUsable);
    const from = priorRatings[priorRatings.length - 1]?.capturedAt ?? windowStart;
    const recent = ratingPoints.filter((s) => s.capturedAt >= from);

    if (recent.length >= 2) {
      const peak = recent.reduce((best, s) => ((s.rating ?? 0) > (best.rating ?? 0) ? s : best), recent[0]!);
      const drop = (peak.rating ?? 0) - (latestRating.rating ?? 0);
      if (drop >= rules.ratingDropThreshold) {
        out.push({
          type: 'RATING_DECLINE',
          severity: 'WARNING',
          message: `Rating is down ${drop} from its recent peak (${peak.rating} → ${latestRating.rating}).`,
          evidence: {
            peak: { date: peak.capturedAt, rating: peak.rating },
            current: { date: latestRating.capturedAt, rating: latestRating.rating },
            drop,
            windowDays: rules.inactivityDays,
          },
        });
      }
    }
  }

  return out.filter((c) => !rules.mutedTypes.includes(c.type));
}

/**
 * Re-evaluates one student and reconciles the stored alerts: new concerns are
 * inserted, ones that still apply keep their original `detectedAt` (so "stalled
 * since 12 Aug" stays true), and ones that no longer apply are removed.
 */
export async function evaluateStudentAlerts(studentId: string, rules?: AlertRules): Promise<number> {
  const activeRules = rules ?? (await getAlertRules());

  const [student, snapshots] = await Promise.all([
    prisma.student.findUnique({
      where: { id: studentId },
      include: { profiles: true, analytics: true },
    }),
    prisma.dataSnapshot.findMany({
      where: { studentId, platform: null },
      orderBy: { capturedAt: 'asc' },
      select: { capturedAt: true, totalSolved: true, rating: true, contestsAttended: true },
      take: 400,
    }),
  ]);

  if (!student) return 0;

  const candidates = evaluateRules({
    rules: activeRules,
    now: new Date(),
    hasHandles: student.profiles.length > 0,
    availableProfiles: student.profiles.filter((p) => p.status === 'AVAILABLE').length,
    brokenProfiles: student.profiles
      .filter((p) => BROKEN_STATUSES.has(p.status))
      .map((p) => ({ platform: p.platform, status: p.status, lastSuccessAt: p.lastSuccessAt })),
    lastSuccessAt: student.profiles
      .map((p) => p.lastSuccessAt)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null,
    snapshots,
    contestsKnown: student.analytics?.contestsKnown ?? false,
  });

  const wanted = new Map(candidates.map((c) => [c.type, c]));

  await prisma.$transaction(async (tx) => {
    // Drop concerns that no longer apply.
    await tx.studentAlert.deleteMany({
      where: { studentId, ...(wanted.size > 0 ? { type: { notIn: [...wanted.keys()] } } : {}) },
    });

    for (const candidate of wanted.values()) {
      await tx.studentAlert.upsert({
        where: { studentId_type: { studentId, type: candidate.type } },
        // detectedAt is only set on insert, so it keeps answering "since when".
        create: {
          studentId,
          type: candidate.type,
          severity: candidate.severity,
          message: candidate.message,
          evidence: candidate.evidence as Prisma.InputJsonValue,
        },
        update: {
          severity: candidate.severity,
          message: candidate.message,
          evidence: candidate.evidence as Prisma.InputJsonValue,
        },
      });
    }
  });

  return wanted.size;
}

/** Re-evaluates every active student, in bounded batches. */
export async function evaluateAllAlerts(studentIds?: string[], batchSize = 25): Promise<number> {
  const rules = await getAlertRules();
  const ids =
    studentIds ?? (await prisma.student.findMany({ where: { isActive: true }, select: { id: true } })).map((s) => s.id);

  let evaluated = 0;
  for (let i = 0; i < ids.length; i += batchSize) {
    await Promise.all(
      ids.slice(i, i + batchSize).map((id) =>
        evaluateStudentAlerts(id, rules).catch((err) =>
          logger.warn(`Alert evaluation failed for student ${id}`, (err as Error).message),
        ),
      ),
    );
    evaluated += Math.min(batchSize, ids.length - i);
  }
  return evaluated;
}

export interface AlertSummary {
  total: number;
  unacknowledged: number;
  byType: { type: AlertType; label: string; severity: AlertSeverity; count: number }[];
  bySeverity: Record<AlertSeverity, number>;
}

export async function getAlertSummary(where: Prisma.StudentAlertWhereInput = {}): Promise<AlertSummary> {
  const [grouped, total, unacknowledged] = await Promise.all([
    prisma.studentAlert.groupBy({ by: ['type', 'severity'], where, _count: { _all: true } }),
    prisma.studentAlert.count({ where }),
    prisma.studentAlert.count({ where: { ...where, acknowledgedAt: null } }),
  ]);

  const bySeverity: Record<AlertSeverity, number> = { INFO: 0, WARNING: 0, CRITICAL: 0 };
  for (const row of grouped) bySeverity[row.severity] += row._count._all;

  return {
    total,
    unacknowledged,
    bySeverity,
    byType: grouped
      .map((row) => ({ type: row.type, label: ALERT_LABELS[row.type], severity: row.severity, count: row._count._all }))
      .sort((a, b) => b.count - a.count),
  };
}
