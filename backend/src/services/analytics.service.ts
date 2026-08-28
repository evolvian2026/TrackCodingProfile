import type { Platform, Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { logger } from '../lib/logger.js';
import { PLATFORMS } from '../config/platforms.js';
import { normalizeTopic } from '../platforms/topics.js';
import { calculateScore, calculateSkill, type ScoreInputs, type ScoreResult } from './scoring.js';
import { getScoringTargets, getScoringWeights, getSkillThresholds } from './settings.service.js';
import { evaluateStudentAlerts } from './alerts.service.js';

/**
 * Recomputes the derived analytics for one student and materializes them into
 * `student_analytics` / `student_skills`.
 *
 * The tables exist so leaderboards and batch dashboards are a single indexed
 * read instead of an aggregation across every profile — which is what keeps the
 * app usable at 10k+ students.
 */
export async function recomputeStudentAnalytics(studentId: string): Promise<void> {
  const [weights, targets, thresholds] = await Promise.all([
    getScoringWeights(),
    getScoringTargets(),
    getSkillThresholds(),
  ]);

  const [profiles, topics, contestAgg, contestCounts, recentTopics] = await Promise.all([
    prisma.platformProfile.findMany({ where: { studentId } }),
    prisma.studentTopic.findMany({ where: { studentId } }),
    prisma.contestResult.aggregate({
      where: { studentId, rank: { not: null } },
      _min: { rank: true },
      _avg: { rank: true },
      _count: { _all: true },
    }),
    prisma.contestResult.groupBy({ by: ['platform'], where: { studentId }, _count: { _all: true } }),
    findRecentlyActiveTopics(studentId, thresholds.recentActivityWindowDays),
  ]);

  const availableProfiles = profiles.filter((p) => p.status === 'AVAILABLE');
  const hasData = availableProfiles.length > 0;

  // Which metrics are even knowable for this student: a platform has to have
  // returned data AND publish that metric. Consumers use these to render N/A
  // instead of a zero we never observed.
  const difficultyKnown = availableProfiles.some((p) => PLATFORMS[p.platform].hasDifficultyBreakdown);
  const topicsKnown = availableProfiles.some((p) => PLATFORMS[p.platform].hasTopics);
  const contestsKnown = availableProfiles.some((p) => PLATFORMS[p.platform].hasContests);

  const sum = (pick: (p: (typeof profiles)[number]) => number | null) =>
    availableProfiles.reduce((acc, p) => acc + (pick(p) ?? 0), 0);

  const totalSolved = sum((p) => p.totalSolved);
  const easySolved = sum((p) => p.easySolved);
  const mediumSolved = sum((p) => p.mediumSolved);
  const hardSolved = sum((p) => p.hardSolved);
  // Solves on platforms that publish a total but no difficulty split.
  const unknownSolved = Math.max(0, totalSolved - easySolved - mediumSolved - hardSolved);

  // Prefer the platform-reported contest count; fall back to stored results.
  const resultCountByPlatform = new Map(contestCounts.map((c) => [c.platform, c._count._all]));
  const totalContests = availableProfiles.reduce((acc, p) => {
    const reported = p.contestsAttended;
    const stored = resultCountByPlatform.get(p.platform) ?? 0;
    return acc + (reported ?? stored);
  }, 0);

  const ratings = availableProfiles
    .map((p) => p.maxRating ?? p.rating ?? p.contestRating)
    .filter((r): r is number => typeof r === 'number');
  const currentRatings = availableProfiles
    .map((p) => p.rating ?? p.contestRating)
    .filter((r): r is number => typeof r === 'number');

  const bestRating = ratings.length > 0 ? Math.max(...ratings) : null;
  const currentRating = currentRatings.length > 0 ? Math.max(...currentRatings) : null;

  const unifiedTopics = new Map<string, { solved: number; platforms: Set<Platform> }>();
  for (const t of topics) {
    if (t.problemsSolved <= 0) continue;
    const canonical = normalizeTopic(t.topic);
    const entry = unifiedTopics.get(canonical) ?? { solved: 0, platforms: new Set<Platform>() };
    entry.solved += t.problemsSolved;
    entry.platforms.add(t.platform);
    unifiedTopics.set(canonical, entry);
  }

  const inputs: ScoreInputs = {
    totalSolved,
    easySolved,
    mediumSolved,
    hardSolved,
    unknownSolved,
    contestsAttended: totalContests,
    bestRating,
    distinctTopics: unifiedTopics.size,
  };

  const scoreResult = hasData
    ? calculateScore(inputs, weights, targets)
    : ({ score: 0, components: [], inputs, targets } as ScoreResult);

  const topicCoverage = targets.topicsTarget > 0
    ? Math.min(100, Math.round((unifiedTopics.size / targets.topicsTarget) * 10000) / 100)
    : 0;

  const analyticsData = {
    totalSolved,
    easySolved,
    mediumSolved,
    hardSolved,
    platformsActive: availableProfiles.length,
    totalContests,
    bestRank: contestAgg._min.rank ?? null,
    avgRank: contestAgg._avg.rank ?? null,
    bestRating,
    currentRating,
    topicCount: unifiedTopics.size,
    topicCoverage,
    cpScore: scoreResult.score,
    scoreBreakdown: scoreResult as unknown as Prisma.InputJsonValue,
    hasData,
    difficultyKnown,
    topicsKnown,
    contestsKnown,
    computedAt: new Date(),
  };

  await prisma.studentAnalytics.upsert({
    where: { studentId },
    create: { studentId, ...analyticsData },
    update: analyticsData,
  });

  // -- skill matrix ---------------------------------------------------------
  const skills = [...unifiedTopics.entries()].map(([topic, entry]) =>
    calculateSkill(
      {
        topic,
        problemsSolved: entry.solved,
        platformCount: entry.platforms.size,
        recentlyActive: recentTopics.has(topic),
      },
      thresholds,
    ),
  );

  await prisma.$transaction([
    prisma.studentSkill.deleteMany({ where: { studentId } }),
    prisma.studentSkill.createMany({
      data: skills.map((s) => ({
        studentId,
        topic: s.topic,
        level: s.level,
        score: s.score,
        problemsSolved: s.problemsSolved,
        platformCount: s.platformCount,
      })),
      skipDuplicates: true,
    }),
  ]);

  await writeAggregateSnapshot(studentId, analyticsData);

  // The needs-attention rules read the snapshot just written, so they run last
  // and never take the recompute down with them.
  await evaluateStudentAlerts(studentId).catch((err) =>
    logger.warn(`Alert evaluation failed for student ${studentId}`, (err as Error).message),
  );
}

/** Topics with at least one problem solved inside the recency window. */
async function findRecentlyActiveTopics(studentId: string, windowDays: number): Promise<Set<string>> {
  const since = new Date(Date.now() - windowDays * 86_400_000);
  const rows = await prisma.studentProblem.findMany({
    where: { studentId, solvedAt: { gte: since } },
    select: { problem: { select: { topics: { select: { topic: { select: { name: true } } } } } } },
    take: 2000,
  });
  const set = new Set<string>();
  for (const row of rows) {
    for (const link of row.problem.topics) set.add(normalizeTopic(link.topic.name));
  }
  return set;
}

/** Daily aggregate snapshot (platform = null) powering the growth charts. */
async function writeAggregateSnapshot(
  studentId: string,
  data: { totalSolved: number; easySolved: number; mediumSolved: number; hardSolved: number; currentRating: number | null; bestRating: number | null; totalContests: number; topicCount: number; cpScore: number },
): Promise<void> {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);

  const existing = await prisma.dataSnapshot.findFirst({
    where: { studentId, platform: null, capturedAt: { gte: dayStart, lt: dayEnd } },
    select: { id: true },
  });

  const payload = {
    totalSolved: data.totalSolved,
    easySolved: data.easySolved,
    mediumSolved: data.mediumSolved,
    hardSolved: data.hardSolved,
    rating: data.currentRating,
    maxRating: data.bestRating,
    contestsAttended: data.totalContests,
    topicCount: data.topicCount,
    cpScore: data.cpScore,
    capturedAt: new Date(),
  };

  if (existing) await prisma.dataSnapshot.update({ where: { id: existing.id }, data: payload });
  else await prisma.dataSnapshot.create({ data: { studentId, platform: null, ...payload } });
}

/**
 * Guarantees an analytics row exists for the given students (or all of them).
 *
 * Students imported without any platform handle are never touched by a
 * processing job, so without this they would have no analytics row at all —
 * and a LEFT JOIN NULL sorts *first* on a descending order in PostgreSQL,
 * putting them at the top of every "best first" list. The stub carries
 * `hasData: false`, which also keeps them out of leaderboards entirely.
 */
export async function ensureAnalyticsRows(studentIds?: string[]): Promise<number> {
  const ids =
    studentIds ??
    (await prisma.student.findMany({ select: { id: true } })).map((s) => s.id);
  if (ids.length === 0) return 0;

  let created = 0;
  for (let i = 0; i < ids.length; i += 1000) {
    const res = await prisma.studentAnalytics.createMany({
      data: ids.slice(i, i + 1000).map((studentId) => ({ studentId })),
      skipDuplicates: true,
    });
    created += res.count;
  }
  return created;
}

/** Recompute in bounded batches so a full rebuild never exhausts the pool. */
export async function recomputeAllAnalytics(
  studentIds?: string[],
  options: { batchSize?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<number> {
  const batchSize = options.batchSize ?? 25;
  const ids =
    studentIds ??
    (await prisma.student.findMany({ where: { isActive: true }, select: { id: true } })).map((s) => s.id);

  let done = 0;
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    await Promise.all(
      batch.map((id) =>
        recomputeStudentAnalytics(id).catch((err) =>
          logger.warn(`Analytics recompute failed for student ${id}`, (err as Error).message),
        ),
      ),
    );
    done += batch.length;
    options.onProgress?.(done, ids.length);
  }
  return done;
}
