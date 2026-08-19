import type { Platform, Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { ALL_PLATFORMS, PLATFORMS } from '../../config/platforms.js';
import { mergeTopicCounts } from '../../platforms/topics.js';
import { NULLABLE_ANALYTICS, buildStudentWhere, type StudentFilters } from '../students/students.service.js';

/** Aggregating 4 numeric columns is cheap; guard against unbounded scans anyway. */
const MAX_AGGREGATE_ROWS = 50_000;

export interface Distribution {
  count: number;
  average: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
}

function distribution(values: number[]): Distribution {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (clean.length === 0) return { count: 0, average: null, median: null, min: null, max: null };
  const mid = Math.floor(clean.length / 2);
  const median = clean.length % 2 === 0 ? (clean[mid - 1]! + clean[mid]!) / 2 : clean[mid]!;
  return {
    count: clean.length,
    average: Math.round((clean.reduce((a, b) => a + b, 0) / clean.length) * 100) / 100,
    median: Math.round(median * 100) / 100,
    min: clean[0]!,
    max: clean[clean.length - 1]!,
  };
}

/** Admin dashboard headline numbers. */
export async function getOverview(filters: StudentFilters = {}) {
  const where = buildStudentWhere(filters);

  const [totalStudents, withData, profileStatus, activeJobs, recentJobs, lastRefresh] = await Promise.all([
    prisma.student.count({ where }),
    prisma.studentAnalytics.count({ where: { hasData: true, student: where } }),
    prisma.platformProfile.groupBy({ by: ['platform', 'status'], where: { student: where }, _count: { _all: true } }),
    prisma.processingJob.count({ where: { status: { in: ['QUEUED', 'RUNNING'] } } }),
    prisma.processingJob.findMany({ orderBy: { createdAt: 'desc' }, take: 5 }),
    prisma.platformProfile.groupBy({ by: ['platform'], _max: { lastSuccessAt: true } }),
  ]);

  const rows = await prisma.studentAnalytics.findMany({
    where: { student: where, hasData: true },
    select: { cpScore: true, totalSolved: true, currentRating: true, totalContests: true, topicCount: true },
    take: MAX_AGGREGATE_ROWS,
  });

  const lastRefreshByPlatform = new Map(lastRefresh.map((r) => [r.platform, r._max.lastSuccessAt]));

  return {
    totalStudents,
    studentsWithData: withData,
    studentsWithoutData: totalStudents - withData,
    activeJobs,
    distributions: {
      cpScore: distribution(rows.map((r) => r.cpScore)),
      problemsSolved: distribution(rows.map((r) => r.totalSolved)),
      rating: distribution(rows.map((r) => r.currentRating ?? Number.NaN)),
      contests: distribution(rows.map((r) => r.totalContests)),
      topics: distribution(rows.map((r) => r.topicCount)),
    },
    platforms: ALL_PLATFORMS.map((platform) => {
      const forPlatform = profileStatus.filter((p) => p.platform === platform);
      const countFor = (status: string) => forPlatform.find((p) => p.status === status)?._count._all ?? 0;
      return {
        platform,
        label: PLATFORMS[platform].label,
        color: PLATFORMS[platform].colors.light,
        colorDark: PLATFORMS[platform].colors.dark,
        linked: forPlatform.reduce((sum, p) => sum + p._count._all, 0),
        available: countFor('AVAILABLE'),
        pending: countFor('PENDING'),
        notFound: countFor('NOT_FOUND'),
        private: countFor('PRIVATE'),
        unavailable: countFor('UNAVAILABLE'),
        rateLimited: countFor('RATE_LIMITED'),
        error: countFor('ERROR'),
        lastRefreshedAt: lastRefreshByPlatform.get(platform) ?? null,
      };
    }),
    recentJobs: recentJobs.map((j) => ({
      id: j.id,
      number: j.number,
      type: j.type,
      status: j.status,
      totalItems: j.totalItems,
      processed: j.processed,
      successful: j.successful,
      failed: j.failed,
      rateLimited: j.rateLimited,
      createdAt: j.createdAt,
    })),
  };
}

export type LeaderboardSort =
  | 'cpScore'
  | 'totalSolved'
  | 'currentRating'
  | 'bestRating'
  | 'totalContests'
  | 'topicCount'
  | 'topicCoverage';

export async function getLeaderboard(
  filters: StudentFilters,
  options: { sortBy?: LeaderboardSort; sortDir?: 'asc' | 'desc'; page?: number; pageSize?: number } = {},
) {
  const sortBy = options.sortBy ?? 'cpScore';
  const sortDir = options.sortDir ?? 'desc';
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, options.pageSize ?? 50));

  // Only students with real data are ranked — an unfetched profile must never
  // appear at the bottom of a leaderboard as if they had solved nothing.
  const where: Prisma.StudentAnalyticsWhereInput = { hasData: true, student: buildStudentWhere(filters) };

  const [total, rows] = await Promise.all([
    prisma.studentAnalytics.count({ where }),
    prisma.studentAnalytics.findMany({
      where,
      orderBy: [
        // NULLS LAST on nullable columns so an unrated student never outranks a
        // rated one on a "highest rating first" sort.
        {
          [sortBy]: NULLABLE_ANALYTICS.has(sortBy) ? { sort: sortDir, nulls: 'last' } : sortDir,
        } as Prisma.StudentAnalyticsOrderByWithRelationInput,
        { totalSolved: 'desc' },
      ],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        student: {
          select: {
            id: true,
            studentId: true,
            name: true,
            college: true,
            batch: true,
            branch: true,
            section: true,
            profiles: { select: { platform: true, status: true, totalSolved: true, rating: true } },
          },
        },
      },
    }),
  ]);

  return {
    data: rows.map((row, index) => ({
      rank: (page - 1) * pageSize + index + 1,
      studentId: row.student.studentId,
      id: row.student.id,
      name: row.student.name,
      college: row.student.college,
      batch: row.student.batch,
      branch: row.student.branch,
      section: row.student.section,
      totalSolved: row.totalSolved,
      easySolved: row.easySolved,
      mediumSolved: row.mediumSolved,
      hardSolved: row.hardSolved,
      currentRating: row.currentRating,
      bestRating: row.bestRating,
      totalContests: row.totalContests,
      topicCount: row.topicCount,
      topicCoverage: row.topicCoverage,
      cpScore: row.cpScore,
      platformsActive: row.platformsActive,
      difficultyKnown: row.difficultyKnown,
      topicsKnown: row.topicsKnown,
      contestsKnown: row.contestsKnown,
      platforms: row.student.profiles.map((p) => ({
        platform: p.platform,
        status: p.status,
        totalSolved: p.totalSolved,
        rating: p.rating,
      })),
    })),
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    sort: { sortBy, sortDir },
  };
}

/** Unified topic dashboard across a filtered cohort. */
export async function getTopicAnalytics(filters: StudentFilters = {}, platform?: Platform) {
  const studentWhere = buildStudentWhere(filters);

  const grouped = await prisma.studentTopic.groupBy({
    by: ['topic'],
    where: { student: studentWhere, ...(platform ? { platform } : {}) },
    _sum: { problemsSolved: true },
    _count: { _all: true },
    orderBy: { _sum: { problemsSolved: 'desc' } },
    take: 200,
  });

  const merged = mergeTopicCounts(
    grouped.map((g) => ({ topic: g.topic, problemsSolved: g._sum.problemsSolved ?? 0 })),
  );
  const studentsPerTopic = new Map(grouped.map((g) => [g.topic, g._count._all]));

  const byPlatform = platform
    ? []
    : await prisma.studentTopic.groupBy({
        by: ['platform', 'topic'],
        where: { student: studentWhere },
        _sum: { problemsSolved: true },
        take: 500,
        orderBy: { _sum: { problemsSolved: 'desc' } },
      });

  const totalSolved = merged.reduce((sum, t) => sum + t.problemsSolved, 0);

  return {
    topics: merged.map((t) => ({
      topic: t.topic,
      problemsSolved: t.problemsSolved,
      studentCount: studentsPerTopic.get(t.topic) ?? 0,
      share: totalSolved > 0 ? Math.round((t.problemsSolved / totalSolved) * 10000) / 100 : 0,
    })),
    /** Heatmap source: topic × platform. */
    heatmap: ALL_PLATFORMS.map((p) => ({
      platform: p,
      label: PLATFORMS[p].label,
      color: PLATFORMS[p].colors.light,
      colorDark: PLATFORMS[p].colors.dark,
      topics: mergeTopicCounts(
        byPlatform.filter((g) => g.platform === p).map((g) => ({ topic: g.topic, problemsSolved: g._sum.problemsSolved ?? 0 })),
      ),
    })).filter((entry) => entry.topics.length > 0),
    totalSolved,
  };
}

/** Difficulty split plus per-platform solved totals for a filtered cohort. */
export async function getDifficultyAnalytics(filters: StudentFilters = {}) {
  const studentWhere = buildStudentWhere(filters);

  const [analytics, byPlatform] = await Promise.all([
    prisma.studentAnalytics.aggregate({
      where: { student: studentWhere, hasData: true },
      _sum: { easySolved: true, mediumSolved: true, hardSolved: true, totalSolved: true },
    }),
    prisma.platformProfile.groupBy({
      by: ['platform'],
      where: { student: studentWhere, status: 'AVAILABLE' },
      _sum: { totalSolved: true, easySolved: true, mediumSolved: true, hardSolved: true },
      _count: { _all: true },
    }),
  ]);

  const easy = analytics._sum.easySolved ?? 0;
  const medium = analytics._sum.mediumSolved ?? 0;
  const hard = analytics._sum.hardSolved ?? 0;
  const total = analytics._sum.totalSolved ?? 0;

  return {
    difficulty: {
      easy,
      medium,
      hard,
      // Platforms that publish a total without a difficulty split.
      unclassified: Math.max(0, total - easy - medium - hard),
      total,
    },
    byPlatform: ALL_PLATFORMS.map((platform) => {
      const row = byPlatform.find((r) => r.platform === platform);
      return {
        platform,
        label: PLATFORMS[platform].label,
        color: PLATFORMS[platform].colors.light,
        colorDark: PLATFORMS[platform].colors.dark,
        studentsWithData: row?._count._all ?? 0,
        totalSolved: row?._sum.totalSolved ?? null,
        easySolved: PLATFORMS[platform].hasDifficultyBreakdown ? (row?._sum.easySolved ?? null) : null,
        mediumSolved: PLATFORMS[platform].hasDifficultyBreakdown ? (row?._sum.mediumSolved ?? null) : null,
        hardSolved: PLATFORMS[platform].hasDifficultyBreakdown ? (row?._sum.hardSolved ?? null) : null,
        supportsDifficulty: PLATFORMS[platform].hasDifficultyBreakdown,
      };
    }),
  };
}

/** Batch-level dashboard: averages, medians, top/bottom performers, strengths. */
export async function getBatchAnalytics(batch: string, filters: StudentFilters = {}) {
  const scoped: StudentFilters = { ...filters, batch };
  const where = buildStudentWhere(scoped);

  const [studentCount, rows, topics] = await Promise.all([
    prisma.student.count({ where }),
    prisma.studentAnalytics.findMany({
      where: { student: where, hasData: true },
      select: {
        studentId: true,
        cpScore: true,
        totalSolved: true,
        currentRating: true,
        bestRating: true,
        totalContests: true,
        topicCount: true,
      },
      take: MAX_AGGREGATE_ROWS,
    }),
    getTopicAnalytics(scoped),
  ]);

  const [topByScore, topBySolved, topByRating, bottomByScore] = await Promise.all([
    leaderboardSlice(where, 'cpScore', 'desc', 10),
    leaderboardSlice(where, 'totalSolved', 'desc', 10),
    leaderboardSlice(where, 'bestRating', 'desc', 10),
    leaderboardSlice(where, 'cpScore', 'asc', 10),
  ]);

  const platformAdoption = await prisma.platformProfile.groupBy({
    by: ['platform', 'status'],
    where: { student: where },
    _count: { _all: true },
  });

  return {
    batch,
    studentCount,
    studentsWithData: rows.length,
    averages: {
      problemsSolved: distribution(rows.map((r) => r.totalSolved)),
      contestRating: distribution(rows.map((r) => r.currentRating ?? Number.NaN)),
      contestParticipation: distribution(rows.map((r) => r.totalContests)),
      cpScore: distribution(rows.map((r) => r.cpScore)),
      topicCoverage: distribution(rows.map((r) => r.topicCount)),
    },
    highlights: {
      topStudent: topByScore[0] ?? null,
      mostProblemsSolved: topBySolved[0] ?? null,
      highestRating: topByRating[0] ?? null,
    },
    top10: topByScore,
    bottom10: bottomByScore,
    platformAdoption: ALL_PLATFORMS.map((platform) => {
      const forPlatform = platformAdoption.filter((p) => p.platform === platform);
      return {
        platform,
        label: PLATFORMS[platform].label,
        color: PLATFORMS[platform].colors.light,
        colorDark: PLATFORMS[platform].colors.dark,
        linked: forPlatform.reduce((sum, p) => sum + p._count._all, 0),
        available: forPlatform.find((p) => p.status === 'AVAILABLE')?._count._all ?? 0,
        adoptionRate:
          studentCount > 0
            ? Math.round((forPlatform.reduce((sum, p) => sum + p._count._all, 0) / studentCount) * 1000) / 10
            : 0,
      };
    }),
    strengths: topics.topics.slice(0, 8),
    weaknesses: [...topics.topics].reverse().slice(0, 8),
  };
}

async function leaderboardSlice(
  studentWhere: Prisma.StudentWhereInput,
  field: LeaderboardSort,
  dir: 'asc' | 'desc',
  take: number,
) {
  const rows = await prisma.studentAnalytics.findMany({
    where: { student: studentWhere, hasData: true },
    orderBy: {
      [field]: NULLABLE_ANALYTICS.has(field) ? { sort: dir, nulls: 'last' } : dir,
    } as Prisma.StudentAnalyticsOrderByWithRelationInput,
    take,
    include: { student: { select: { id: true, studentId: true, name: true, college: true, batch: true, branch: true } } },
  });

  return rows.map((row, index) => ({
    rank: index + 1,
    id: row.student.id,
    studentId: row.student.studentId,
    name: row.student.name,
    college: row.student.college,
    batch: row.student.batch,
    branch: row.student.branch,
    cpScore: row.cpScore,
    totalSolved: row.totalSolved,
    currentRating: row.currentRating,
    bestRating: row.bestRating,
    totalContests: row.totalContests,
    topicCount: row.topicCount,
  }));
}

/** Compares every college (or university) present in the database. */
export async function getInstitutionAnalytics(
  groupBy: 'college' | 'university' = 'college',
  filters: StudentFilters = {},
) {
  const where = buildStudentWhere(filters);

  const students = await prisma.student.findMany({
    where: { ...where, [groupBy]: { not: null } },
    select: {
      id: true,
      college: true,
      university: true,
      analytics: {
        select: { cpScore: true, totalSolved: true, currentRating: true, totalContests: true, topicCount: true, hasData: true },
      },
    },
    take: MAX_AGGREGATE_ROWS,
  });

  const groups = new Map<string, { total: number; withData: number; scores: number[]; solved: number[]; ratings: number[]; contests: number[]; topics: number[] }>();

  for (const student of students) {
    const key = (groupBy === 'college' ? student.college : student.university) ?? 'Unspecified';
    const group = groups.get(key) ?? { total: 0, withData: 0, scores: [], solved: [], ratings: [], contests: [], topics: [] };
    group.total += 1;
    if (student.analytics?.hasData) {
      group.withData += 1;
      group.scores.push(student.analytics.cpScore);
      group.solved.push(student.analytics.totalSolved);
      group.contests.push(student.analytics.totalContests);
      group.topics.push(student.analytics.topicCount);
      if (student.analytics.currentRating !== null) group.ratings.push(student.analytics.currentRating);
    }
    groups.set(key, group);
  }

  return [...groups.entries()]
    .map(([name, g]) => ({
      name,
      studentCount: g.total,
      studentsWithData: g.withData,
      averageScore: distribution(g.scores).average ?? 0,
      averageProblemsSolved: distribution(g.solved).average ?? 0,
      averageRating: distribution(g.ratings).average,
      averageContests: distribution(g.contests).average ?? 0,
      averageTopicCoverage: distribution(g.topics).average ?? 0,
    }))
    .sort((a, b) => b.averageScore - a.averageScore);
}

/** Cohort-wide growth: total solved and mean score per day. */
export async function getGrowthTrend(filters: StudentFilters = {}, days = 90) {
  const since = new Date(Date.now() - days * 86_400_000);
  const snapshots = await prisma.dataSnapshot.findMany({
    where: { platform: null, capturedAt: { gte: since }, student: buildStudentWhere(filters) },
    select: { capturedAt: true, totalSolved: true, cpScore: true, rating: true },
    orderBy: { capturedAt: 'asc' },
    take: MAX_AGGREGATE_ROWS,
  });

  const byDay = new Map<string, { solved: number[]; score: number[]; rating: number[] }>();
  for (const s of snapshots) {
    const day = s.capturedAt.toISOString().slice(0, 10);
    const entry = byDay.get(day) ?? { solved: [], score: [], rating: [] };
    if (s.totalSolved !== null) entry.solved.push(s.totalSolved);
    if (s.cpScore !== null) entry.score.push(s.cpScore);
    if (s.rating !== null) entry.rating.push(s.rating);
    byDay.set(day, entry);
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, entry]) => ({
      date,
      students: entry.solved.length,
      totalSolved: entry.solved.reduce((a, b) => a + b, 0),
      averageSolved: distribution(entry.solved).average,
      averageScore: distribution(entry.score).average,
      averageRating: distribution(entry.rating).average,
    }));
}
