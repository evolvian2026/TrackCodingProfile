import crypto from 'node:crypto';
import { prisma } from '../db/prisma.js';
import { env } from '../config/env.js';
import { PLATFORMS, ALL_PLATFORMS } from '../config/platforms.js';
import { notFound } from '../lib/errors.js';
import { getGoalsForStudent } from './goals.service.js';

/**
 * Read-only links that let a student see their own record without an account.
 *
 * The token is stored hashed, exactly like a refresh token: a database dump, a
 * log line or a support screenshot of this table hands nobody a working link.
 * That means a link can be issued and revoked but never recovered — regenerate
 * instead, which invalidates the old one.
 */
const TOKEN_BYTES = 32;

const hash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

/** Where the SPA lives, for building the link we hand a coordinator. */
export function shareBaseUrl(): string {
  if (env.APP_BASE_URL) return env.APP_BASE_URL.replace(/\/+$/, '');
  return (env.CORS_ORIGIN.split(',')[0] ?? '').trim().replace(/\/+$/, '');
}

export const shareUrlFor = (token: string) => `${shareBaseUrl()}/me/${token}`;

export interface IssuedLink {
  studentId: string;
  /** The institution-issued identifier, which is what a mail merge keys on. */
  rollNumber: string;
  name: string;
  email: string | null;
  url: string;
}

/**
 * Issues a link, replacing any existing one for that student.
 *
 * Replacing rather than accumulating keeps the mental model simple: a student
 * has at most one live link, and regenerating is how you take an old one out of
 * circulation.
 */
export async function issueShareLink(
  studentId: string,
  options: { createdById?: string | null; expiresAt?: Date | null } = {},
): Promise<IssuedLink> {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { id: true, studentId: true, name: true, email: true },
  });
  if (!student) throw notFound('Student not found');

  const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  await prisma.studentShareLink.upsert({
    where: { studentId },
    create: {
      studentId,
      tokenHash: hash(token),
      createdById: options.createdById ?? null,
      expiresAt: options.expiresAt ?? null,
    },
    update: {
      tokenHash: hash(token),
      createdById: options.createdById ?? null,
      expiresAt: options.expiresAt ?? null,
      // A regenerated link is a new link: the old usage would misreport it.
      revokedAt: null,
      createdAt: new Date(),
      lastViewedAt: null,
      viewCount: 0,
    },
  });

  return {
    studentId: student.id,
    rollNumber: student.studentId,
    name: student.name,
    email: student.email,
    url: shareUrlFor(token),
  };
}

export async function revokeShareLink(studentId: string): Promise<boolean> {
  const result = await prisma.studentShareLink.updateMany({
    where: { studentId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count > 0;
}

export async function getShareLinkStatus(studentId: string) {
  const link = await prisma.studentShareLink.findUnique({
    where: { studentId },
    include: { createdBy: { select: { name: true } } },
  });
  if (!link) return null;

  return {
    createdAt: link.createdAt,
    createdBy: link.createdBy?.name ?? null,
    expiresAt: link.expiresAt,
    revokedAt: link.revokedAt,
    lastViewedAt: link.lastViewedAt,
    viewCount: link.viewCount,
    active: !link.revokedAt && (!link.expiresAt || link.expiresAt > new Date()),
    // Deliberately absent: the link itself. It is not recoverable by design.
    url: null,
  };
}

/** Issues links for a whole cohort in one pass, for a mail merge. */
export async function issueShareLinksFor(
  studentIds: string[],
  options: { createdById?: string | null; expiresAt?: Date | null } = {},
): Promise<IssuedLink[]> {
  const issued: IssuedLink[] = [];
  for (const id of studentIds) issued.push(await issueShareLink(id, options));
  return issued;
}

/**
 * Alerts that describe our own data collection rather than the student's work.
 * Showing a student "your handle is wrong" is fine; showing them "we have not
 * refreshed you in three weeks" is us reporting our own failure to them as
 * though it were news they could act on.
 */
const OPERATOR_ONLY = new Set(['STALE_DATA']);

/**
 * Resolves a token to the student's own view of their record.
 *
 * What is deliberately not here: email, phone, internal notes, the CP score
 * breakdown of anyone else, and any other student by name. The rank is included
 * because position without identities is motivating rather than exposing.
 */
export async function resolveSharedView(token: string) {
  const link = await prisma.studentShareLink.findUnique({
    where: { tokenHash: hash(token) },
    select: { id: true, studentId: true, revokedAt: true, expiresAt: true },
  });
  if (!link || link.revokedAt) return null;
  if (link.expiresAt && link.expiresAt <= new Date()) return null;

  const student = await prisma.student.findUnique({
    where: { id: link.studentId },
    include: {
      profiles: true,
      analytics: true,
      skills: { orderBy: { score: 'desc' } },
      topics: true,
      alerts: { orderBy: { severity: 'desc' } },
    },
  });
  if (!student || !student.isActive) return null;

  const [lastSnapshot, history, goals, rank] = await Promise.all([
    prisma.dataSnapshot.findFirst({
      where: { studentId: student.id, platform: null },
      orderBy: { capturedAt: 'desc' },
      select: { capturedAt: true },
    }),
    prisma.dataSnapshot.findMany({
      where: { studentId: student.id, platform: null },
      orderBy: { capturedAt: 'asc' },
      select: { capturedAt: true, totalSolved: true, cpScore: true, rating: true, contestsAttended: true },
      take: 400,
    }),
    getGoalsForStudent(student.id),
    cohortRank(student),
  ]);

  // Fire-and-forget: a view counter must never fail a page load.
  void prisma.studentShareLink
    .update({ where: { id: link.id }, data: { viewCount: { increment: 1 }, lastViewedAt: new Date() } })
    .catch(() => undefined);

  const topics = new Map<string, number>();
  for (const row of student.topics) topics.set(row.topic, (topics.get(row.topic) ?? 0) + row.problemsSolved);

  return {
    student: {
      name: student.name,
      studentId: student.studentId,
      college: student.college,
      batch: student.batch,
      branch: student.branch,
      section: student.section,
    },
    analytics: student.analytics,
    platforms: student.profiles.map((p) => ({
      platform: p.platform,
      label: PLATFORMS[p.platform].label,
      color: PLATFORMS[p.platform].colors.light,
      colorDark: PLATFORMS[p.platform].colors.dark,
      username: p.username,
      profileUrl: p.profileUrl ?? PLATFORMS[p.platform].profileUrl(p.username),
      status: p.status,
      statusMessage: p.statusMessage,
      lastSuccessAt: p.lastSuccessAt,
      totalSolved: p.totalSolved,
      easySolved: p.easySolved,
      mediumSolved: p.mediumSolved,
      hardSolved: p.hardSolved,
      rating: p.rating,
      maxRating: p.maxRating,
      contestsAttended: p.contestsAttended,
      globalRank: p.globalRank,
      capabilities: {
        hasDifficultyBreakdown: PLATFORMS[p.platform].hasDifficultyBreakdown,
        hasContests: PLATFORMS[p.platform].hasContests,
        hasTopics: PLATFORMS[p.platform].hasTopics,
      },
    })),
    // Ordered so the platforms a student has not linked are still visible as a
    // gap they can close, rather than silently absent.
    unlinkedPlatforms: ALL_PLATFORMS.filter((p) => !student.profiles.some((x) => x.platform === p)).map((p) => ({
      platform: p,
      label: PLATFORMS[p].label,
    })),
    skills: student.skills.map((s) => ({ topic: s.topic, level: s.level, score: s.score, problemsSolved: s.problemsSolved })),
    topics: [...topics.entries()]
      .map(([topic, problemsSolved]) => ({ topic, problemsSolved }))
      .sort((a, b) => b.problemsSolved - a.problemsSolved),
    history,
    goals,
    concerns: student.alerts
      .filter((a) => !OPERATOR_ONLY.has(a.type))
      .map((a) => ({ type: a.type, severity: a.severity, message: a.message, detectedAt: a.detectedAt })),
    rank,
    lastRefreshedAt: lastSnapshot?.capturedAt ?? null,
  };
}

/**
 * The student's position among their own batch, without naming anybody.
 * Null when they have no data — an unranked student is not last.
 */
async function cohortRank(student: { id: string; batch: string | null; college: string | null }) {
  const analytics = await prisma.studentAnalytics.findUnique({
    where: { studentId: student.id },
    select: { cpScore: true, hasData: true },
  });
  if (!analytics?.hasData) return null;

  const scope = {
    isActive: true,
    ...(student.batch ? { batch: student.batch } : {}),
    ...(student.college ? { college: student.college } : {}),
  };

  const [total, ahead] = await Promise.all([
    prisma.studentAnalytics.count({ where: { student: scope, hasData: true } }),
    prisma.studentAnalytics.count({ where: { student: scope, hasData: true, cpScore: { gt: analytics.cpScore } } }),
  ]);

  return { position: ahead + 1, of: total, scope: student.batch ?? student.college ?? 'all students' };
}
