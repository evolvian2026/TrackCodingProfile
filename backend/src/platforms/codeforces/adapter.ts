import type { Difficulty, Platform } from '@prisma/client';
import { BaseAdapter, type SnapshotParts } from '../base.js';
import { platformRequest } from '../http.js';
import { normalizeTopics } from '../topics.js';
import { PlatformFetchError, type NormalizedActivity, type NormalizedContest, type NormalizedProblem, type NormalizedProfile, type NormalizedRatingPoint, type NormalizedTopic } from '../types.js';
import { platformMeta } from '../../config/platforms.js';

const API = 'https://codeforces.com/api';
/** Codeforces caps `user.status` responses; 5k submissions is plenty per student. */
const MAX_SUBMISSIONS = 5000;

interface CfEnvelope<T> {
  status: 'OK' | 'FAILED';
  result?: T;
  comment?: string;
}

interface CfUser {
  handle: string;
  firstName?: string;
  lastName?: string;
  country?: string;
  city?: string;
  organization?: string;
  contribution?: number;
  rank?: string;
  rating?: number;
  maxRank?: string;
  maxRating?: number;
  friendOfCount?: number;
  titlePhoto?: string;
}

interface CfRatingChange {
  contestId: number;
  contestName: string;
  handle: string;
  rank: number;
  ratingUpdateTimeSeconds: number;
  oldRating: number;
  newRating: number;
}

interface CfSubmission {
  id: number;
  contestId?: number;
  creationTimeSeconds: number;
  problem: { contestId?: number; problemsetName?: string; index: string; name: string; type: string; rating?: number; tags: string[] };
  verdict?: string;
}

/**
 * Codeforces exposes a documented public API (https://codeforces.com/apiHelp),
 * so this adapter never scrapes HTML.
 */
export class CodeforcesAdapter extends BaseAdapter {
  readonly platform: Platform = 'CODEFORCES';
  readonly label = 'Codeforces';

  buildProfileUrl(username: string): string {
    return platformMeta('CODEFORCES').profileUrl(username);
  }

  override validateUsername(username: string) {
    const u = this.normalizeUsername(username);
    if (!u) return { valid: false, reason: 'Handle is empty' };
    if (!/^[A-Za-z0-9._-]{3,24}$/.test(u)) {
      return { valid: false, reason: 'Codeforces handles are 3-24 chars of letters, digits, dot, underscore or dash' };
    }
    return { valid: true };
  }

  protected async load(username: string): Promise<SnapshotParts> {
    const user = await this.fetchUser(username);

    // Rating history and submissions are independent; a failure in one must not
    // discard the profile we already retrieved.
    const [ratingChanges, submissions] = await Promise.all([
      this.fetchRatingHistory(username).catch(() => null),
      this.fetchSubmissions(username).catch(() => null),
    ]);

    const solved = submissions ? extractSolved(submissions) : null;
    const attempted = submissions ? new Set(submissions.map((s) => problemKey(s))).size : null;
    const accepted = submissions ? submissions.filter((s) => s.verdict === 'OK').length : null;

    const profile: NormalizedProfile = {
      username: user.handle,
      profileUrl: this.buildProfileUrl(user.handle),
      displayName: [user.firstName, user.lastName].filter(Boolean).join(' ') || null,
      country: user.country ?? null,
      avatarUrl: user.titlePhoto ?? null,
      rating: user.rating ?? null,
      maxRating: user.maxRating ?? null,
      rankTitle: user.rank ?? null,
      maxRankTitle: user.maxRank ?? null,
      contribution: user.contribution ?? null,
      friendCount: user.friendOfCount ?? null,
      totalSolved: solved ? solved.problems.length : null,
      easySolved: solved ? countByDifficulty(solved.problems, 'EASY') : null,
      mediumSolved: solved ? countByDifficulty(solved.problems, 'MEDIUM') : null,
      hardSolved: solved ? countByDifficulty(solved.problems, 'HARD') : null,
      problemsAttempted: attempted,
      totalSubmissions: submissions ? submissions.length : null,
      acceptedSubmissions: accepted,
      acceptanceRate:
        submissions && submissions.length > 0 ? Number(((accepted! / submissions.length) * 100).toFixed(2)) : null,
      contestsAttended: ratingChanges ? ratingChanges.length : null,
      contestRating: user.rating ?? null,
      raw: { organization: user.organization ?? null, city: user.city ?? null },
    };

    const contests: NormalizedContest[] = (ratingChanges ?? []).map((rc) => ({
      externalId: String(rc.contestId),
      name: rc.contestName,
      startTime: new Date(rc.ratingUpdateTimeSeconds * 1000),
      url: `https://codeforces.com/contest/${rc.contestId}`,
      rank: rc.rank,
      ratingBefore: rc.oldRating,
      ratingAfter: rc.newRating,
      ratingChange: rc.newRating - rc.oldRating,
      problemsSolved: submissions ? countContestSolves(submissions, rc.contestId) : null,
    }));

    const ratings: NormalizedRatingPoint[] = (ratingChanges ?? []).map((rc) => ({
      rating: rc.newRating,
      recordedAt: new Date(rc.ratingUpdateTimeSeconds * 1000),
      contestName: rc.contestName,
    }));

    const recent: NormalizedActivity[] = (submissions ?? [])
      .filter((s) => s.verdict === 'OK')
      .slice(0, 25)
      .map((s) => ({
        title: s.problem.name,
        url: problemUrl(s),
        difficulty: ratingToDifficulty(s.problem.rating),
        topics: normalizeTopics(s.problem.tags ?? []),
        solvedAt: new Date(s.creationTimeSeconds * 1000),
      }));

    return {
      profile: this.ok(profile),
      problems: solved ? this.ok(solved.problems) : this.notPublic<NormalizedProblem[]>('this submission history'),
      topics: solved ? this.ok(solved.topics) : this.notPublic<NormalizedTopic[]>('this submission history'),
      contests: ratingChanges ? this.ok(contests) : this.notPublic<NormalizedContest[]>('this contest history'),
      ratings: ratingChanges ? this.ok(ratings) : this.notPublic<NormalizedRatingPoint[]>('this rating history'),
      ranking: this.ok({
        globalRank: null,
        countryRank: null,
        rankTitle: user.rank ?? null,
        topPercentage: null,
      }),
      recentActivity: submissions ? this.ok(recent) : this.notPublic<NormalizedActivity[]>('this submission history'),
    };
  }

  private async fetchUser(handle: string): Promise<CfUser> {
    const res = await platformRequest<CfEnvelope<CfUser[]>>(
      this.platform,
      `${API}/user.info?handles=${encodeURIComponent(handle)}&checkHistoricHandles=false`,
    );
    if (res.data.status !== 'OK' || !res.data.result?.length) {
      const comment = res.data.comment ?? 'Unknown Codeforces error';
      if (/not found/i.test(comment)) throw new PlatformFetchError('NOT_FOUND', `Codeforces handle "${handle}" not found`);
      throw new PlatformFetchError('ERROR', comment);
    }
    return res.data.result[0]!;
  }

  private async fetchRatingHistory(handle: string): Promise<CfRatingChange[]> {
    const res = await platformRequest<CfEnvelope<CfRatingChange[]>>(
      this.platform,
      `${API}/user.rating?handle=${encodeURIComponent(handle)}`,
    );
    if (res.data.status !== 'OK') throw new PlatformFetchError('UNAVAILABLE', res.data.comment ?? 'rating history unavailable');
    return res.data.result ?? [];
  }

  private async fetchSubmissions(handle: string): Promise<CfSubmission[]> {
    const res = await platformRequest<CfEnvelope<CfSubmission[]>>(
      this.platform,
      `${API}/user.status?handle=${encodeURIComponent(handle)}&from=1&count=${MAX_SUBMISSIONS}`,
    );
    if (res.data.status !== 'OK') throw new PlatformFetchError('UNAVAILABLE', res.data.comment ?? 'submissions unavailable');
    return res.data.result ?? [];
  }
}

// -- pure helpers (unit-tested directly) -------------------------------------

export function ratingToDifficulty(rating?: number): Difficulty {
  if (rating === undefined || rating === null) return 'UNKNOWN';
  if (rating <= 1200) return 'EASY';
  if (rating <= 1900) return 'MEDIUM';
  return 'HARD';
}

export function problemKey(s: CfSubmission): string {
  const contestId = s.problem.contestId ?? s.contestId ?? 0;
  return `${contestId}-${s.problem.index}`;
}

function problemUrl(s: CfSubmission): string | null {
  const contestId = s.problem.contestId ?? s.contestId;
  return contestId ? `https://codeforces.com/problemset/problem/${contestId}/${s.problem.index}` : null;
}

export function extractSolved(submissions: CfSubmission[]): { problems: NormalizedProblem[]; topics: NormalizedTopic[] } {
  const byKey = new Map<string, NormalizedProblem>();
  for (const s of submissions) {
    if (s.verdict !== 'OK') continue;
    const key = problemKey(s);
    const solvedAt = new Date(s.creationTimeSeconds * 1000);
    const existing = byKey.get(key);
    if (existing) {
      // Keep the earliest accepted submission as the solve date.
      if (existing.solvedAt && solvedAt < existing.solvedAt) existing.solvedAt = solvedAt;
      continue;
    }
    byKey.set(key, {
      externalId: key,
      name: s.problem.name,
      url: problemUrl(s),
      difficulty: ratingToDifficulty(s.problem.rating),
      topics: normalizeTopics(s.problem.tags ?? []),
      points: s.problem.rating ?? null,
      solvedAt,
    });
  }

  const problems = [...byKey.values()];
  const tally = new Map<string, number>();
  for (const p of problems) for (const t of p.topics) tally.set(t, (tally.get(t) ?? 0) + 1);

  return {
    problems,
    topics: [...tally.entries()]
      .map(([topic, problemsSolved]) => ({ topic, problemsSolved }))
      .sort((a, b) => b.problemsSolved - a.problemsSolved),
  };
}

function countByDifficulty(problems: NormalizedProblem[], difficulty: Difficulty): number {
  return problems.filter((p) => p.difficulty === difficulty).length;
}

function countContestSolves(submissions: CfSubmission[], contestId: number): number {
  const solved = new Set<string>();
  for (const s of submissions) {
    if (s.verdict === 'OK' && (s.problem.contestId ?? s.contestId) === contestId) solved.add(s.problem.index);
  }
  return solved.size;
}
