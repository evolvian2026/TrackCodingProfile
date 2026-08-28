import type { GoalMetric, Prisma, StudentAnalytics } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { buildStudentWhere, type StudentFilters } from '../modules/students/students.service.js';

/**
 * Goals measure a cohort against an absolute target by a date.
 *
 * The whole design turns on one question: what does a target mean for a student
 * whose platforms do not publish the metric? Counting them as "not met" would
 * report a gap in the platforms' data as a student failing, which is the exact
 * mistake the rest of this application refuses to make. So every outcome is one
 * of four states, and the percentage is computed over the students the metric
 * is knowable for, with the rest reported separately rather than folded in.
 */
export type TargetOutcome = 'MET' | 'BEHIND' | 'UNKNOWN' | 'NO_DATA';

export const GOAL_METRICS = [
  'PROBLEMS_SOLVED',
  'CONTESTS_ATTENDED',
  'CP_SCORE',
  'CONTEST_RATING',
  'TOPICS_COVERED',
] as const satisfies readonly GoalMetric[];

export const METRIC_LABELS: Record<GoalMetric, string> = {
  PROBLEMS_SOLVED: 'Problems solved',
  CONTESTS_ATTENDED: 'Contests entered',
  CP_SCORE: 'CP score',
  CONTEST_RATING: 'Contest rating',
  TOPICS_COVERED: 'Topics covered',
};

/** Whole numbers everywhere except the score, which the app computes to 1dp. */
export const METRIC_DECIMALS: Record<GoalMetric, number> = {
  PROBLEMS_SOLVED: 0,
  CONTESTS_ATTENDED: 0,
  CP_SCORE: 1,
  CONTEST_RATING: 0,
  TOPICS_COVERED: 0,
};

type AnalyticsSlice = Pick<
  StudentAnalytics,
  | 'totalSolved'
  | 'totalContests'
  | 'cpScore'
  | 'currentRating'
  | 'topicCount'
  | 'hasData'
  | 'contestsKnown'
  | 'topicsKnown'
>;

/**
 * Reads one metric off a student's analytics.
 *
 * `known: false` is not the same as `value: 0`. A student whose only working
 * platform is HackerRank has no contest history to report — that is a silence,
 * not a zero, and it has to stay a silence all the way through to the progress
 * bar.
 */
export function readMetric(
  analytics: AnalyticsSlice | null,
  metric: GoalMetric,
): { value: number | null; known: boolean } {
  if (!analytics || !analytics.hasData) return { value: null, known: false };

  switch (metric) {
    case 'PROBLEMS_SOLVED':
      return { value: analytics.totalSolved, known: true };
    case 'CP_SCORE':
      return { value: analytics.cpScore, known: true };
    case 'CONTESTS_ATTENDED':
      return analytics.contestsKnown
        ? { value: analytics.totalContests, known: true }
        : { value: null, known: false };
    case 'TOPICS_COVERED':
      return analytics.topicsKnown ? { value: analytics.topicCount, known: true } : { value: null, known: false };
    case 'CONTEST_RATING':
      // A rating exists only where a platform publishes one. No rating is not a
      // rating of zero, and it is not evidence of anything about the student.
      return analytics.currentRating === null
        ? { value: null, known: false }
        : { value: analytics.currentRating, known: true };
  }
}

export function outcomeFor(
  analytics: AnalyticsSlice | null,
  metric: GoalMetric,
  target: number,
): { outcome: TargetOutcome; value: number | null; remaining: number | null } {
  if (!analytics || !analytics.hasData) return { outcome: 'NO_DATA', value: null, remaining: null };

  const { value, known } = readMetric(analytics, metric);
  if (!known || value === null) return { outcome: 'UNKNOWN', value: null, remaining: null };

  return {
    outcome: value >= target ? 'MET' : 'BEHIND',
    value,
    remaining: Math.max(0, target - value),
  };
}

/** The cohort a goal applies to. Null scope fields widen it. */
export function goalScope(goal: {
  university: string | null;
  college: string | null;
  batch: string | null;
  branch: string | null;
  section: string | null;
}): StudentFilters {
  return {
    ...(goal.university ? { university: goal.university } : {}),
    ...(goal.college ? { college: goal.college } : {}),
    ...(goal.batch ? { batch: goal.batch } : {}),
    ...(goal.branch ? { branch: goal.branch } : {}),
    ...(goal.section ? { section: goal.section } : {}),
  };
}

export function describeScope(goal: Parameters<typeof goalScope>[0]): string {
  const parts = [goal.university, goal.college, goal.batch, goal.branch, goal.section].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'Everyone';
}

const DAY_MS = 86_400_000;

export function daysUntil(due: Date, now = new Date()): number {
  return Math.ceil((due.getTime() - now.getTime()) / DAY_MS);
}

/**
 * How many more per week the student needs to hit the target in time.
 *
 * Pure arithmetic on two observed numbers and a date — deliberately not a
 * prediction of whether they will make it. Null once the deadline has passed,
 * because "per week" stops meaning anything then.
 */
export function requiredPerWeek(remaining: number, dueOn: Date, now = new Date()): number | null {
  const days = daysUntil(dueOn, now);
  if (days <= 0) return null;
  return Math.round((remaining / (days / 7)) * 10) / 10;
}

export interface GoalProgress {
  studentsInScope: number;
  /** Students meeting every target that is knowable for them. */
  onTrack: number;
  targets: {
    metric: GoalMetric;
    label: string;
    target: number;
    met: number;
    behind: number;
    /** The metric is not published for any platform this student uses. */
    unknown: number;
    /** Nothing has ever been retrieved for this student. */
    noData: number;
    /** Share of the students it is measurable for. Null when that is nobody. */
    metRate: number | null;
    /** Median shortfall among those behind, so "how far off" has an answer. */
    medianRemaining: number | null;
  }[];
}

/** Bounded like the other aggregates; goals are cohort-sized, not corpus-sized. */
const MAX_SCOPE_ROWS = 20_000;

export async function computeGoalProgress(
  goal: {
    university: string | null;
    college: string | null;
    batch: string | null;
    branch: string | null;
    section: string | null;
    targets: { metric: GoalMetric; target: number }[];
  },
  extraFilters: StudentFilters = {},
): Promise<GoalProgress> {
  const where = buildStudentWhere({ ...extraFilters, ...goalScope(goal) });

  const rows = await prisma.student.findMany({
    where,
    select: {
      id: true,
      analytics: {
        select: {
          totalSolved: true,
          totalContests: true,
          cpScore: true,
          currentRating: true,
          topicCount: true,
          hasData: true,
          contestsKnown: true,
          topicsKnown: true,
        },
      },
    },
    take: MAX_SCOPE_ROWS,
  });

  const targets = goal.targets.map((t) => {
    const outcomes = rows.map((r) => outcomeFor(r.analytics, t.metric, t.target));
    const behind = outcomes.filter((o) => o.outcome === 'BEHIND');
    const met = outcomes.filter((o) => o.outcome === 'MET').length;
    const measurable = met + behind.length;

    return {
      metric: t.metric,
      label: METRIC_LABELS[t.metric],
      target: t.target,
      met,
      behind: behind.length,
      unknown: outcomes.filter((o) => o.outcome === 'UNKNOWN').length,
      noData: outcomes.filter((o) => o.outcome === 'NO_DATA').length,
      metRate: measurable > 0 ? Math.round((met / measurable) * 1000) / 10 : null,
      medianRemaining: median(behind.map((o) => o.remaining ?? 0)),
    };
  });

  // "On track" means every target we can actually measure for this student is
  // met. A student we cannot measure at all is not on track and not behind —
  // they are counted in the unknown column of each target instead.
  const onTrack = rows.filter((row) =>
    goal.targets.every((t) => outcomeFor(row.analytics, t.metric, t.target).outcome === 'MET'),
  ).length;

  return { studentsInScope: rows.length, onTrack, targets };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export interface StudentGoalProgress {
  id: string;
  name: string;
  description: string | null;
  scope: string;
  startsOn: Date;
  dueOn: Date;
  daysLeft: number;
  targets: {
    metric: GoalMetric;
    label: string;
    target: number;
    value: number | null;
    outcome: TargetOutcome;
    remaining: number | null;
    requiredPerWeek: number | null;
    /** Change over the goal window, from dated snapshots. Null when unobserved. */
    observedGain: number | null;
    observedOverDays: number | null;
  }[];
}

/**
 * Every active goal that covers one student, with their standing against each
 * target. This is the per-student view; the cohort roll-up above deliberately
 * does not do the snapshot work, because it would be one query per student.
 */
export async function getGoalsForStudent(studentId: string, now = new Date()): Promise<StudentGoalProgress[]> {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: {
      university: true,
      college: true,
      batch: true,
      branch: true,
      section: true,
      analytics: {
        select: {
          totalSolved: true,
          totalContests: true,
          cpScore: true,
          currentRating: true,
          topicCount: true,
          hasData: true,
          contestsKnown: true,
          topicsKnown: true,
        },
      },
    },
  });
  if (!student) return [];

  // A null scope field on the goal means "any", so match it or match nothing.
  const scopeMatches = <T extends string>(field: T) =>
    ({ OR: [{ [field]: null }, { [field]: student[field as keyof typeof student] as string | null }] }) as Prisma.GoalWhereInput;

  const goals = await prisma.goal.findMany({
    where: {
      isActive: true,
      AND: [
        scopeMatches('university'),
        scopeMatches('college'),
        scopeMatches('batch'),
        scopeMatches('branch'),
        scopeMatches('section'),
      ],
    },
    include: { targets: true },
    orderBy: { dueOn: 'asc' },
  });
  if (goals.length === 0) return [];

  const earliest = goals.reduce((min, g) => (g.startsOn < min ? g.startsOn : min), goals[0]!.startsOn);
  const snapshots = await prisma.dataSnapshot.findMany({
    where: { studentId, platform: null, capturedAt: { gte: earliest } },
    orderBy: { capturedAt: 'asc' },
    select: { capturedAt: true, totalSolved: true, contestsAttended: true, cpScore: true, rating: true, topicCount: true },
  });

  return goals.map((goal) => ({
    id: goal.id,
    name: goal.name,
    description: goal.description,
    scope: describeScope(goal),
    startsOn: goal.startsOn,
    dueOn: goal.dueOn,
    daysLeft: daysUntil(goal.dueOn, now),
    targets: goal.targets.map((t) => {
      const { outcome, value, remaining } = outcomeFor(student.analytics, t.metric, t.target);
      const observed = observedGain(snapshots, t.metric, goal.startsOn);
      return {
        metric: t.metric,
        label: METRIC_LABELS[t.metric],
        target: t.target,
        value,
        outcome,
        remaining,
        requiredPerWeek: remaining === null ? null : requiredPerWeek(remaining, goal.dueOn, now),
        observedGain: observed?.gain ?? null,
        observedOverDays: observed?.days ?? null,
      };
    }),
  }));
}

type SnapshotRow = {
  capturedAt: Date;
  totalSolved: number | null;
  contestsAttended: number | null;
  cpScore: number | null;
  rating: number | null;
  topicCount: number | null;
};

const SNAPSHOT_FIELD: Record<GoalMetric, keyof Omit<SnapshotRow, 'capturedAt'>> = {
  PROBLEMS_SOLVED: 'totalSolved',
  CONTESTS_ATTENDED: 'contestsAttended',
  CP_SCORE: 'cpScore',
  CONTEST_RATING: 'rating',
  TOPICS_COVERED: 'topicCount',
};

/**
 * What actually changed since the goal opened, from dated readings.
 *
 * An observation, not a forecast: it reports the ground covered so far and
 * over how long, and leaves the comparison against the required pace to the
 * reader. Null whenever there are not two readings to subtract.
 */
function observedGain(
  snapshots: SnapshotRow[],
  metric: GoalMetric,
  since: Date,
): { gain: number; days: number } | null {
  const field = SNAPSHOT_FIELD[metric];
  const points = snapshots.filter((s) => s[field] !== null && s.capturedAt >= since);
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last || first === last) return null;

  const days = Math.max(1, Math.round((last.capturedAt.getTime() - first.capturedAt.getTime()) / DAY_MS));
  return { gain: Math.round(((last[field] as number) - (first[field] as number)) * 10) / 10, days };
}
