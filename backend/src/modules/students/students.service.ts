import type { Platform, Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { notFound } from '../../lib/errors.js';
import { ALL_PLATFORMS, PLATFORMS } from '../../config/platforms.js';
import { mergeTopicCounts, normalizeTopic } from '../../platforms/topics.js';
import { getScoringTargets, getScoringWeights } from '../../services/settings.service.js';
import { calculateScore } from '../../services/scoring.js';

export interface StudentFilters {
  search?: string;
  university?: string;
  college?: string;
  batch?: string;
  branch?: string;
  section?: string;
  platform?: Platform;
  /** Only students whose profile on `platform` (or any platform) has this status. */
  status?: string;
  minRating?: number;
  maxRating?: number;
  minSolved?: number;
  maxSolved?: number;
  minContests?: number;
  minScore?: number;
  hasData?: boolean;
  ids?: string[];
}

export interface Pagination {
  page: number;
  pageSize: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}

/** Analytics columns that can hold NULL and therefore need explicit NULLS LAST. */
export const NULLABLE_ANALYTICS = new Set(['currentRating', 'bestRating', 'bestRank', 'avgRank']);

const SORTABLE_ANALYTICS = new Set([
  'cpScore',
  'totalSolved',
  'currentRating',
  'bestRating',
  'totalContests',
  'topicCount',
  'topicCoverage',
  'easySolved',
  'mediumSolved',
  'hardSolved',
]);

export function buildStudentWhere(filters: StudentFilters): Prisma.StudentWhereInput {
  const where: Prisma.StudentWhereInput = { isActive: true };

  if (filters.ids?.length) where.id = { in: filters.ids };
  if (filters.university) where.university = filters.university;
  if (filters.college) where.college = filters.college;
  if (filters.batch) where.batch = filters.batch;
  if (filters.branch) where.branch = filters.branch;
  if (filters.section) where.section = filters.section;

  if (filters.search) {
    const q = filters.search.trim();
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { studentId: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
      { college: { contains: q, mode: 'insensitive' } },
      { profiles: { some: { username: { contains: q, mode: 'insensitive' } } } },
    ];
  }

  const profileFilter: Prisma.PlatformProfileWhereInput = {};
  if (filters.platform) profileFilter.platform = filters.platform;
  if (filters.status) profileFilter.status = filters.status as Prisma.PlatformProfileWhereInput['status'];
  if (Object.keys(profileFilter).length > 0) where.profiles = { some: profileFilter };

  const analytics: Prisma.StudentAnalyticsWhereInput = {};
  if (filters.minRating !== undefined) analytics.currentRating = { gte: filters.minRating };
  if (filters.maxRating !== undefined) {
    analytics.currentRating = { ...(analytics.currentRating as object), lte: filters.maxRating };
  }
  if (filters.minSolved !== undefined) analytics.totalSolved = { gte: filters.minSolved };
  if (filters.maxSolved !== undefined) {
    analytics.totalSolved = { ...(analytics.totalSolved as object), lte: filters.maxSolved };
  }
  if (filters.minContests !== undefined) analytics.totalContests = { gte: filters.minContests };
  if (filters.minScore !== undefined) analytics.cpScore = { gte: filters.minScore };
  if (filters.hasData !== undefined) analytics.hasData = filters.hasData;
  if (Object.keys(analytics).length > 0) where.analytics = analytics;

  return where;
}

export interface StudentListItem {
  id: string;
  studentId: string;
  name: string;
  email: string | null;
  college: string | null;
  batch: string | null;
  branch: string | null;
  section: string | null;
  analytics: {
    totalSolved: number;
    easySolved: number;
    mediumSolved: number;
    hardSolved: number;
    totalContests: number;
    currentRating: number | null;
    bestRating: number | null;
    topicCount: number;
    cpScore: number;
    platformsActive: number;
    hasData: boolean;
    computedAt: Date;
  } | null;
  platforms: {
    platform: Platform;
    label: string;
    username: string;
    status: string;
    statusMessage: string | null;
    totalSolved: number | null;
    rating: number | null;
    lastSuccessAt: Date | null;
  }[];
}

/** Paginated student list. Never returns everything — the UI is virtualized. */
export async function listStudents(filters: StudentFilters, pagination: Pagination) {
  const where = buildStudentWhere(filters);
  const page = Math.max(1, pagination.page);
  const pageSize = Math.min(200, Math.max(1, pagination.pageSize));
  const sortDir = pagination.sortDir ?? 'desc';

  // `nulls: 'last'` matters on the nullable columns: PostgreSQL orders NULLs
  // FIRST on a descending sort, which would otherwise float unrated students to
  // the top of "best first" lists. Non-nullable columns reject the option, and
  // every student is guaranteed an analytics row (see `ensureAnalyticsRows`), so
  // a missing relation cannot produce a NULL either.
  const analyticsOrder = (field: string): Prisma.StudentOrderByWithRelationInput => ({
    analytics: {
      [field]: NULLABLE_ANALYTICS.has(field) ? { sort: sortDir, nulls: 'last' } : sortDir,
    } as Prisma.StudentAnalyticsOrderByWithRelationInput,
  });

  const orderBy: Prisma.StudentOrderByWithRelationInput =
    pagination.sortBy && SORTABLE_ANALYTICS.has(pagination.sortBy)
      ? analyticsOrder(pagination.sortBy)
      : pagination.sortBy === 'name'
        ? { name: sortDir }
        : pagination.sortBy === 'studentId'
          ? { studentId: sortDir }
          : analyticsOrder('cpScore');

  const [total, students] = await Promise.all([
    prisma.student.count({ where }),
    prisma.student.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        analytics: true,
        profiles: {
          select: {
            platform: true,
            username: true,
            status: true,
            statusMessage: true,
            totalSolved: true,
            rating: true,
            lastSuccessAt: true,
          },
        },
      },
    }),
  ]);

  return {
    data: students.map(toListItem),
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  };
}

type ListRow = Prisma.StudentGetPayload<{
  include: {
    analytics: true;
    profiles: {
      select: {
        platform: true;
        username: true;
        status: true;
        statusMessage: true;
        totalSolved: true;
        rating: true;
        lastSuccessAt: true;
      };
    };
  };
}>;

function toListItem(student: ListRow): StudentListItem {
  return {
    id: student.id,
    studentId: student.studentId,
    name: student.name,
    email: student.email,
    college: student.college,
    batch: student.batch,
    branch: student.branch,
    section: student.section,
    analytics: student.analytics
      ? {
          totalSolved: student.analytics.totalSolved,
          easySolved: student.analytics.easySolved,
          mediumSolved: student.analytics.mediumSolved,
          hardSolved: student.analytics.hardSolved,
          totalContests: student.analytics.totalContests,
          currentRating: student.analytics.currentRating,
          bestRating: student.analytics.bestRating,
          topicCount: student.analytics.topicCount,
          cpScore: student.analytics.cpScore,
          platformsActive: student.analytics.platformsActive,
          hasData: student.analytics.hasData,
          computedAt: student.analytics.computedAt,
        }
      : null,
    platforms: student.profiles.map((p) => ({
      platform: p.platform,
      label: PLATFORMS[p.platform].label,
      username: p.username,
      status: p.status,
      statusMessage: p.statusMessage,
      totalSolved: p.totalSolved,
      rating: p.rating,
      lastSuccessAt: p.lastSuccessAt,
    })),
  };
}

export async function getStudentOrThrow(id: string) {
  const student = await prisma.student.findFirst({
    where: { OR: [{ id }, { studentId: id }] },
    include: { analytics: true, profiles: { orderBy: { platform: 'asc' } } },
  });
  if (!student) throw notFound('Student not found');
  return student;
}

/** Everything the individual student dashboard needs, in one round trip. */
export async function getStudentDetail(id: string) {
  const student = await getStudentOrThrow(id);
  const [topics, skills, contestCount, lastSnapshot] = await Promise.all([
    prisma.studentTopic.findMany({ where: { studentId: student.id } }),
    prisma.studentSkill.findMany({ where: { studentId: student.id }, orderBy: { score: 'desc' } }),
    prisma.contestResult.count({ where: { studentId: student.id } }),
    prisma.dataSnapshot.findFirst({
      where: { studentId: student.id, platform: null },
      orderBy: { capturedAt: 'desc' },
      select: { capturedAt: true },
    }),
  ]);

  return {
    ...student,
    platforms: student.profiles.map((p) => ({
      ...p,
      label: PLATFORMS[p.platform].label,
      color: PLATFORMS[p.platform].color,
      profileUrl: p.profileUrl ?? PLATFORMS[p.platform].profileUrl(p.username),
      capabilities: {
        hasDifficultyBreakdown: PLATFORMS[p.platform].hasDifficultyBreakdown,
        hasContests: PLATFORMS[p.platform].hasContests,
        hasTopics: PLATFORMS[p.platform].hasTopics,
      },
    })),
    topics: mergeTopicCounts(topics),
    skills,
    contestCount,
    lastRefreshedAt: lastSnapshot?.capturedAt ?? null,
  };
}

export async function getStudentTopics(id: string, platform?: Platform) {
  const student = await getStudentOrThrow(id);
  const rows = await prisma.studentTopic.findMany({
    where: { studentId: student.id, ...(platform ? { platform } : {}) },
  });

  const byPlatform: Record<string, { topic: string; problemsSolved: number }[]> = {};
  for (const p of ALL_PLATFORMS) {
    const forPlatform = rows.filter((r) => r.platform === p);
    if (forPlatform.length > 0) byPlatform[p] = mergeTopicCounts(forPlatform);
  }

  return { unified: mergeTopicCounts(rows), byPlatform };
}

export async function getStudentProblems(
  id: string,
  options: { platform?: Platform; difficulty?: string; topic?: string; page?: number; pageSize?: number },
) {
  const student = await getStudentOrThrow(id);
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, options.pageSize ?? 50));

  const where: Prisma.StudentProblemWhereInput = {
    studentId: student.id,
    ...(options.platform ? { platform: options.platform } : {}),
    ...(options.difficulty || options.topic
      ? {
          problem: {
            ...(options.difficulty ? { difficulty: options.difficulty as Prisma.ProblemWhereInput['difficulty'] } : {}),
            ...(options.topic ? { topics: { some: { topic: { name: normalizeTopic(options.topic) } } } } : {}),
          },
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.studentProblem.count({ where }),
    prisma.studentProblem.findMany({
      where,
      orderBy: [{ solvedAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { problem: { include: { topics: { include: { topic: true } } } } },
    }),
  ]);

  return {
    data: rows.map((row) => ({
      id: row.id,
      platform: row.platform,
      solvedAt: row.solvedAt,
      name: row.problem.name,
      url: row.problem.url,
      difficulty: row.problem.difficulty,
      points: row.problem.points,
      topics: row.problem.topics.map((t) => t.topic.name),
    })),
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  };
}

export async function getStudentContests(id: string, platform?: Platform) {
  const student = await getStudentOrThrow(id);
  const results = await prisma.contestResult.findMany({
    where: { studentId: student.id, ...(platform ? { platform } : {}) },
    include: { contest: true },
    orderBy: { participatedAt: 'desc' },
    take: 500,
  });

  const ranks = results.map((r) => r.rank).filter((r): r is number => r !== null);
  const byPlatform = ALL_PLATFORMS.map((p) => ({
    platform: p,
    label: PLATFORMS[p].label,
    color: PLATFORMS[p].color,
    count: results.filter((r) => r.platform === p).length,
  })).filter((r) => r.count > 0);

  return {
    data: results.map((r) => ({
      id: r.id,
      platform: r.platform,
      name: r.contest.name,
      url: r.contest.url,
      date: r.participatedAt ?? r.contest.startTime,
      rank: r.rank,
      ratingBefore: r.ratingBefore,
      ratingAfter: r.ratingAfter,
      ratingChange: r.ratingChange,
      problemsSolved: r.problemsSolved,
    })),
    summary: {
      total: results.length,
      byPlatform,
      bestRank: ranks.length > 0 ? Math.min(...ranks) : null,
      averageRank: ranks.length > 0 ? Math.round(ranks.reduce((a, b) => a + b, 0) / ranks.length) : null,
    },
  };
}

export async function getStudentRatings(id: string, platform?: Platform) {
  const student = await getStudentOrThrow(id);
  const history = await prisma.ratingHistory.findMany({
    where: { studentId: student.id, ...(platform ? { platform } : {}) },
    orderBy: { recordedAt: 'asc' },
    take: 2000,
  });

  const series = ALL_PLATFORMS.map((p) => {
    const points = history.filter((h) => h.platform === p);
    return {
      platform: p,
      label: PLATFORMS[p].label,
      color: PLATFORMS[p].color,
      points: points.map((h) => ({ date: h.recordedAt, rating: h.rating, contestName: h.contestName })),
      current: points.at(-1)?.rating ?? null,
      peak: points.length > 0 ? Math.max(...points.map((h) => h.rating)) : null,
    };
  }).filter((s) => s.points.length > 0);

  return { series };
}

/** Point-in-time history for the growth chart. */
export async function getStudentHistory(id: string, platform?: Platform, days = 180) {
  const student = await getStudentOrThrow(id);
  const since = new Date(Date.now() - days * 86_400_000);
  const snapshots = await prisma.dataSnapshot.findMany({
    where: {
      studentId: student.id,
      capturedAt: { gte: since },
      ...(platform ? { platform } : { platform: null }),
    },
    orderBy: { capturedAt: 'asc' },
  });

  return snapshots.map((s) => ({
    date: s.capturedAt,
    totalSolved: s.totalSolved,
    easySolved: s.easySolved,
    mediumSolved: s.mediumSolved,
    hardSolved: s.hardSolved,
    rating: s.rating,
    contestsAttended: s.contestsAttended,
    topicCount: s.topicCount,
    cpScore: s.cpScore,
  }));
}

/** Recomputes the score live so weight changes can be previewed before saving. */
export async function previewScore(id: string, overrides?: Partial<Record<string, number>>) {
  const student = await getStudentOrThrow(id);
  const analytics = student.analytics;
  if (!analytics) throw notFound('This student has no computed analytics yet');

  const [weights, targets] = await Promise.all([getScoringWeights(), getScoringTargets()]);
  const merged = { ...weights, ...(overrides ?? {}) } as typeof weights;

  const unknownSolved = Math.max(
    0,
    analytics.totalSolved - analytics.easySolved - analytics.mediumSolved - analytics.hardSolved,
  );

  return calculateScore(
    {
      totalSolved: analytics.totalSolved,
      easySolved: analytics.easySolved,
      mediumSolved: analytics.mediumSolved,
      hardSolved: analytics.hardSolved,
      unknownSolved,
      contestsAttended: analytics.totalContests,
      bestRating: analytics.bestRating,
      distinctTopics: analytics.topicCount,
    },
    merged,
    targets,
  );
}

export async function compareStudents(ids: string[]) {
  const students = await prisma.student.findMany({
    where: { id: { in: ids } },
    include: { analytics: true, profiles: true, skills: { orderBy: { score: 'desc' }, take: 12 } },
  });

  const topicRows = await prisma.studentTopic.findMany({ where: { studentId: { in: ids } } });

  return students.map((student) => {
    const topics = mergeTopicCounts(topicRows.filter((t) => t.studentId === student.id));
    return {
      id: student.id,
      studentId: student.studentId,
      name: student.name,
      college: student.college,
      batch: student.batch,
      branch: student.branch,
      analytics: student.analytics,
      topics: topics.slice(0, 15),
      skills: student.skills,
      platforms: student.profiles.map((p) => ({
        platform: p.platform,
        label: PLATFORMS[p.platform].label,
        status: p.status,
        totalSolved: p.totalSolved,
        rating: p.rating,
        contestsAttended: p.contestsAttended,
      })),
    };
  });
}

/** Distinct values powering the global filter dropdowns. */
export async function getFilterOptions() {
  const [universities, colleges, batches, branches, sections] = await Promise.all([
    prisma.student.findMany({ where: { university: { not: null } }, select: { university: true }, distinct: ['university'], orderBy: { university: 'asc' } }),
    prisma.student.findMany({ where: { college: { not: null } }, select: { college: true }, distinct: ['college'], orderBy: { college: 'asc' } }),
    prisma.student.findMany({ where: { batch: { not: null } }, select: { batch: true }, distinct: ['batch'], orderBy: { batch: 'asc' } }),
    prisma.student.findMany({ where: { branch: { not: null } }, select: { branch: true }, distinct: ['branch'], orderBy: { branch: 'asc' } }),
    prisma.student.findMany({ where: { section: { not: null } }, select: { section: true }, distinct: ['section'], orderBy: { section: 'asc' } }),
  ]);

  return {
    universities: universities.map((r) => r.university!).filter(Boolean),
    colleges: colleges.map((r) => r.college!).filter(Boolean),
    batches: batches.map((r) => r.batch!).filter(Boolean),
    branches: branches.map((r) => r.branch!).filter(Boolean),
    sections: sections.map((r) => r.section!).filter(Boolean),
    platforms: ALL_PLATFORMS.map((p) => ({ key: p, label: PLATFORMS[p].label, color: PLATFORMS[p].color })),
  };
}

/** Lightweight typeahead for the global search bar. */
export async function quickSearch(query: string, limit = 10) {
  const q = query.trim();
  if (q.length < 2) return [];

  const students = await prisma.student.findMany({
    where: {
      isActive: true,
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { studentId: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { college: { contains: q, mode: 'insensitive' } },
        { profiles: { some: { username: { contains: q, mode: 'insensitive' } } } },
      ],
    },
    take: limit,
    include: {
      profiles: { select: { platform: true, username: true, status: true } },
      analytics: { select: { cpScore: true, totalSolved: true } },
    },
    orderBy: { name: 'asc' },
  });

  return students.map((s) => ({
    id: s.id,
    studentId: s.studentId,
    name: s.name,
    college: s.college,
    batch: s.batch,
    branch: s.branch,
    cpScore: s.analytics?.cpScore ?? null,
    totalSolved: s.analytics?.totalSolved ?? null,
    handles: s.profiles.map((p) => ({ platform: p.platform, label: PLATFORMS[p.platform].label, username: p.username, status: p.status })),
  }));
}
