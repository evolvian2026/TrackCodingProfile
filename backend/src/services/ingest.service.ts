import type { DataStatus, Platform, Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { logger } from '../lib/logger.js';
import { topicSlug } from '../platforms/topics.js';
import type { PlatformSnapshot } from '../platforms/types.js';

const CHUNK = 500;

export interface IngestOutcome {
  status: DataStatus;
  message?: string;
  problemsStored: number;
  topicsStored: number;
  contestsStored: number;
  ratingPointsStored: number;
}

/**
 * Persists one platform snapshot for one student.
 *
 * Two rules drive everything here:
 *  1. A failed fetch never destroys previously retrieved data — only the status
 *     fields are updated, so the dashboard keeps showing the last known good
 *     numbers alongside "last updated" and the failure reason.
 *  2. Values the platform did not report stay NULL. They are never defaulted
 *     to 0, because "solved nothing" and "we could not find out" are different
 *     facts and the UI renders them differently.
 */
export async function ingestSnapshot(
  studentId: string,
  snapshot: PlatformSnapshot,
  options: { jobId?: string } = {},
): Promise<IngestOutcome> {
  const { platform } = snapshot;

  if (snapshot.status !== 'AVAILABLE') {
    await prisma.platformProfile.updateMany({
      where: { studentId, platform },
      data: {
        status: snapshot.status,
        statusMessage: snapshot.statusMessage ?? null,
        lastFetchedAt: snapshot.fetchedAt,
        fetchDurationMs: snapshot.durationMs,
        profileUrl: snapshot.profileUrl,
      },
    });
    await recordError(studentId, platform, snapshot.status, snapshot.statusMessage ?? 'Unknown failure', options.jobId);
    return { status: snapshot.status, message: snapshot.statusMessage, problemsStored: 0, topicsStored: 0, contestsStored: 0, ratingPointsStored: 0 };
  }

  const profile = snapshot.profile.data!;

  const profileData: Prisma.PlatformProfileUncheckedUpdateInput = {
    username: snapshot.username,
    profileUrl: snapshot.profileUrl,
    status: 'AVAILABLE',
    statusMessage: null,
    lastFetchedAt: snapshot.fetchedAt,
    lastSuccessAt: snapshot.fetchedAt,
    fetchDurationMs: snapshot.durationMs,
    displayName: profile.displayName ?? null,
    country: profile.country ?? null,
    avatarUrl: profile.avatarUrl ?? null,
    rating: profile.rating ?? null,
    maxRating: profile.maxRating ?? null,
    rankTitle: profile.rankTitle ?? null,
    maxRankTitle: profile.maxRankTitle ?? null,
    globalRank: profile.globalRank ?? null,
    countryRank: profile.countryRank ?? null,
    stars: profile.stars ?? null,
    reputation: profile.reputation ?? null,
    contribution: profile.contribution ?? null,
    friendCount: profile.friendCount ?? null,
    totalSolved: profile.totalSolved ?? null,
    easySolved: profile.easySolved ?? null,
    mediumSolved: profile.mediumSolved ?? null,
    hardSolved: profile.hardSolved ?? null,
    problemsAttempted: profile.problemsAttempted ?? null,
    totalSubmissions: profile.totalSubmissions ?? null,
    acceptedSubmissions: profile.acceptedSubmissions ?? null,
    acceptanceRate: profile.acceptanceRate ?? null,
    contestsAttended: profile.contestsAttended ?? null,
    contestRating: profile.contestRating ?? null,
    contestGlobalRanking: profile.contestGlobalRanking ?? null,
    contestTopPercentage: profile.contestTopPercentage ?? null,
    problemSolvingScore: profile.problemSolvingScore ?? null,
    badges: toJson(profile.badges),
    certificates: toJson(profile.certificates),
    skills: toJson(profile.skills),
    domains: toJson(profile.domains),
    raw: toJson(profile.raw),
  };

  await prisma.platformProfile.upsert({
    where: { studentId_platform: { studentId, platform } },
    create: { ...(profileData as Prisma.PlatformProfileUncheckedCreateInput), studentId, platform },
    update: profileData,
  });

  const [problemsStored, topicsStored, contestsStored, ratingPointsStored] = await Promise.all([
    storeProblems(studentId, snapshot),
    storeTopics(studentId, snapshot),
    storeContests(studentId, snapshot),
    storeRatings(studentId, snapshot),
  ]);

  await writeSnapshotRow(studentId, snapshot);

  return { status: 'AVAILABLE', problemsStored, topicsStored, contestsStored, ratingPointsStored };
}

// ---------------------------------------------------------------------------

async function storeProblems(studentId: string, snapshot: PlatformSnapshot): Promise<number> {
  const problems = snapshot.problems.data;
  if (!problems?.length) return 0;
  const { platform } = snapshot;

  for (const batch of chunk(problems, CHUNK)) {
    await prisma.problem.createMany({
      data: batch.map((p) => ({
        platform,
        externalId: p.externalId,
        name: p.name,
        url: p.url ?? null,
        difficulty: p.difficulty,
        points: p.points ?? null,
      })),
      skipDuplicates: true,
    });
  }

  const stored = await prisma.problem.findMany({
    where: { platform, externalId: { in: problems.map((p) => p.externalId) } },
    select: { id: true, externalId: true },
  });
  const idByExternal = new Map(stored.map((p) => [p.externalId, p.id]));

  // Topic links for the catalog entries.
  const topicNames = [...new Set(problems.flatMap((p) => p.topics))];
  if (topicNames.length > 0) {
    await prisma.topic.createMany({
      data: topicNames.map((name) => ({ name, slug: topicSlug(name) })),
      skipDuplicates: true,
    });
    const topics = await prisma.topic.findMany({ where: { name: { in: topicNames } }, select: { id: true, name: true } });
    const topicIdByName = new Map(topics.map((t) => [t.name, t.id]));

    const links = problems.flatMap((p) => {
      const problemId = idByExternal.get(p.externalId);
      if (!problemId) return [];
      return p.topics
        .map((name) => topicIdByName.get(name))
        .filter((topicId): topicId is string => Boolean(topicId))
        .map((topicId) => ({ problemId, topicId }));
    });
    for (const batch of chunk(links, CHUNK)) {
      await prisma.problemTopic.createMany({ data: batch, skipDuplicates: true });
    }
  }

  const solves = problems
    .map((p) => {
      const problemId = idByExternal.get(p.externalId);
      return problemId ? { studentId, problemId, platform, solvedAt: p.solvedAt ?? null } : null;
    })
    .filter((v): v is { studentId: string; problemId: string; platform: Platform; solvedAt: Date | null } => v !== null);

  let count = 0;
  for (const batch of chunk(solves, CHUNK)) {
    const res = await prisma.studentProblem.createMany({ data: batch, skipDuplicates: true });
    count += res.count;
  }
  return count;
}

async function storeTopics(studentId: string, snapshot: PlatformSnapshot): Promise<number> {
  const topics = snapshot.topics.data;
  if (!topics?.length) return 0;
  const { platform } = snapshot;

  // Topic totals are absolute counts, so the previous set is replaced wholesale
  // — otherwise a renamed or removed topic would linger forever.
  await prisma.$transaction([
    prisma.studentTopic.deleteMany({ where: { studentId, platform } }),
    prisma.studentTopic.createMany({
      data: topics.map((t) => ({ studentId, platform, topic: t.topic, problemsSolved: t.problemsSolved })),
      skipDuplicates: true,
    }),
  ]);
  return topics.length;
}

async function storeContests(studentId: string, snapshot: PlatformSnapshot): Promise<number> {
  const contests = snapshot.contests.data;
  if (!contests?.length) return 0;
  const { platform } = snapshot;

  await prisma.contest.createMany({
    data: contests.map((c) => ({
      platform,
      externalId: c.externalId,
      name: c.name,
      startTime: c.startTime ?? null,
      url: c.url ?? null,
    })),
    skipDuplicates: true,
  });

  const stored = await prisma.contest.findMany({
    where: { platform, externalId: { in: contests.map((c) => c.externalId) } },
    select: { id: true, externalId: true },
  });
  const idByExternal = new Map(stored.map((c) => [c.externalId, c.id]));

  let count = 0;
  for (const c of contests) {
    const contestId = idByExternal.get(c.externalId);
    if (!contestId) continue;
    const data = {
      platform,
      rank: c.rank ?? null,
      ratingBefore: c.ratingBefore ?? null,
      ratingAfter: c.ratingAfter ?? null,
      ratingChange: c.ratingChange ?? null,
      problemsSolved: c.problemsSolved ?? null,
      participatedAt: c.startTime ?? null,
    };
    await prisma.contestResult.upsert({
      where: { studentId_contestId: { studentId, contestId } },
      create: { studentId, contestId, ...data },
      update: data,
    });
    count += 1;
  }
  return count;
}

async function storeRatings(studentId: string, snapshot: PlatformSnapshot): Promise<number> {
  const ratings = snapshot.ratings.data;
  if (!ratings?.length) return 0;
  const res = await prisma.ratingHistory.createMany({
    data: ratings.map((r) => ({
      studentId,
      platform: snapshot.platform,
      rating: r.rating,
      recordedAt: r.recordedAt,
      source: 'contest',
      contestName: r.contestName ?? null,
    })),
    skipDuplicates: true,
  });
  return res.count;
}

/**
 * One snapshot per student/platform per day. Re-running a refresh on the same
 * day updates that day's row instead of inflating the history.
 */
async function writeSnapshotRow(studentId: string, snapshot: PlatformSnapshot): Promise<void> {
  const profile = snapshot.profile.data;
  if (!profile) return;

  const dayStart = new Date(snapshot.fetchedAt);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);

  const metrics = {
    totalSolved: profile.totalSolved ?? null,
    easySolved: profile.easySolved ?? null,
    mediumSolved: profile.mediumSolved ?? null,
    hardSolved: profile.hardSolved ?? null,
    rating: profile.rating ?? null,
    maxRating: profile.maxRating ?? null,
    globalRank: profile.globalRank ?? null,
    contestsAttended: profile.contestsAttended ?? null,
    topicCount: snapshot.topics.data?.length ?? null,
  };

  const existing = await prisma.dataSnapshot.findFirst({
    where: { studentId, platform: snapshot.platform, capturedAt: { gte: dayStart, lt: dayEnd } },
    select: { id: true },
  });

  const payload = {
    ...metrics,
    capturedAt: snapshot.fetchedAt,
    metrics: metrics as unknown as Prisma.InputJsonValue,
  };

  if (existing) await prisma.dataSnapshot.update({ where: { id: existing.id }, data: payload });
  else await prisma.dataSnapshot.create({ data: { studentId, platform: snapshot.platform, ...payload } });
}

async function recordError(
  studentId: string,
  platform: Platform,
  status: DataStatus,
  message: string,
  jobId?: string,
): Promise<void> {
  try {
    await prisma.platformError.create({ data: { studentId, platform, status, message, jobId: jobId ?? null } });
  } catch (err) {
    logger.warn('Failed to record platform error', (err as Error).message);
  }
}

function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === undefined || value === null) return null as unknown as typeof Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
