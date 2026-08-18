import type { Difficulty, Platform } from '@prisma/client';
import { BaseAdapter, type SnapshotParts } from '../base.js';
import { platformRequest } from '../http.js';
import { normalizeTopic } from '../topics.js';
import {
  PlatformFetchError,
  type NormalizedActivity,
  type NormalizedContest,
  type NormalizedProblem,
  type NormalizedProfile,
  type NormalizedRatingPoint,
  type NormalizedTopic,
} from '../types.js';
import { platformMeta } from '../../config/platforms.js';

const GRAPHQL = 'https://leetcode.com/graphql';

/**
 * LeetCode has no documented public REST API, but it serves an unauthenticated
 * GraphQL endpoint that backs its own public profile pages. We query only the
 * fields a logged-out visitor can already see.
 */
const PROFILE_QUERY = `
query trackerUserData($username: String!, $recentLimit: Int!) {
  matchedUser(username: $username) {
    username
    githubUrl
    profile {
      realName
      userAvatar
      ranking
      reputation
      countryName
      school
      aboutMe
    }
    submitStatsGlobal: submitStats {
      acSubmissionNum { difficulty count submissions }
      totalSubmissionNum { difficulty count submissions }
    }
    tagProblemCounts {
      advanced { tagName tagSlug problemsSolved }
      intermediate { tagName tagSlug problemsSolved }
      fundamental { tagName tagSlug problemsSolved }
    }
  }
  userContestRanking(username: $username) {
    attendedContestsCount
    rating
    globalRanking
    totalParticipants
    topPercentage
  }
  userContestRankingHistory(username: $username) {
    attended
    rating
    ranking
    problemsSolved
    totalProblems
    contest { title startTime }
  }
  recentAcSubmissionList(username: $username, limit: $recentLimit) {
    id
    title
    titleSlug
    timestamp
  }
}`;

interface LcTagCount {
  tagName: string;
  tagSlug: string;
  problemsSolved: number;
}

interface LcSubmitNum {
  difficulty: 'All' | 'Easy' | 'Medium' | 'Hard';
  count: number;
  submissions: number;
}

interface LcResponse {
  data?: {
    matchedUser: {
      username: string;
      profile: {
        realName?: string | null;
        userAvatar?: string | null;
        ranking?: number | null;
        reputation?: number | null;
        countryName?: string | null;
        school?: string | null;
      } | null;
      submitStatsGlobal?: { acSubmissionNum: LcSubmitNum[]; totalSubmissionNum: LcSubmitNum[] } | null;
      tagProblemCounts?: { advanced: LcTagCount[]; intermediate: LcTagCount[]; fundamental: LcTagCount[] } | null;
    } | null;
    userContestRanking: {
      attendedContestsCount?: number | null;
      rating?: number | null;
      globalRanking?: number | null;
      totalParticipants?: number | null;
      topPercentage?: number | null;
    } | null;
    userContestRankingHistory?:
      | {
          attended: boolean;
          rating: number;
          ranking: number | null;
          problemsSolved: number | null;
          totalProblems: number | null;
          contest: { title: string; startTime: number } | null;
        }[]
      | null;
    recentAcSubmissionList?: { id: string; title: string; titleSlug: string; timestamp: string }[] | null;
  };
  errors?: { message: string }[];
}

export class LeetCodeAdapter extends BaseAdapter {
  readonly platform: Platform = 'LEETCODE';
  readonly label = 'LeetCode';

  buildProfileUrl(username: string): string {
    return platformMeta('LEETCODE').profileUrl(username);
  }

  override normalizeUsername(input: string): string {
    const trimmed = (input ?? '').trim();
    if (!trimmed) return '';
    // Both /u/<name>/ and the legacy /<name>/ profile shapes appear in sheets.
    const match = trimmed.match(/leetcode\.com\/(?:u\/)?([^/?#]+)/i);
    if (match?.[1]) return decodeURIComponent(match[1]);
    return super.normalizeUsername(trimmed);
  }

  protected async load(username: string): Promise<SnapshotParts> {
    const res = await platformRequest<LcResponse>(this.platform, GRAPHQL, {
      method: 'POST',
      headers: { referer: 'https://leetcode.com' },
      body: { query: PROFILE_QUERY, variables: { username, recentLimit: 20 } },
    });

    const payload = res.data;
    if (payload.errors?.length && !payload.data?.matchedUser) {
      const message = payload.errors[0]!.message;
      if (/not found|does not exist/i.test(message)) {
        throw new PlatformFetchError('NOT_FOUND', `LeetCode user "${username}" not found`);
      }
      throw new PlatformFetchError('ERROR', message);
    }

    const user = payload.data?.matchedUser;
    if (!user) throw new PlatformFetchError('NOT_FOUND', `LeetCode user "${username}" not found`);

    const ac = user.submitStatsGlobal?.acSubmissionNum ?? [];
    const total = user.submitStatsGlobal?.totalSubmissionNum ?? [];
    const solvedFor = (d: LcSubmitNum['difficulty']) => ac.find((x) => x.difficulty === d)?.count ?? null;
    const totalSubmissions = total.find((x) => x.difficulty === 'All')?.submissions ?? null;
    const acceptedSubmissions = ac.find((x) => x.difficulty === 'All')?.submissions ?? null;

    const contestRanking = payload.data?.userContestRanking ?? null;
    const history = (payload.data?.userContestRankingHistory ?? []).filter((h) => h.attended);

    const profile: NormalizedProfile = {
      username: user.username,
      profileUrl: this.buildProfileUrl(user.username),
      displayName: user.profile?.realName ?? null,
      country: user.profile?.countryName ?? null,
      avatarUrl: user.profile?.userAvatar ?? null,
      globalRank: user.profile?.ranking ?? null,
      reputation: user.profile?.reputation ?? null,
      totalSolved: solvedFor('All'),
      easySolved: solvedFor('Easy'),
      mediumSolved: solvedFor('Medium'),
      hardSolved: solvedFor('Hard'),
      totalSubmissions,
      acceptedSubmissions,
      acceptanceRate:
        totalSubmissions && acceptedSubmissions !== null && totalSubmissions > 0
          ? Number(((acceptedSubmissions / totalSubmissions) * 100).toFixed(2))
          : null,
      contestsAttended: contestRanking?.attendedContestsCount ?? null,
      contestRating: contestRanking?.rating != null ? Math.round(contestRanking.rating) : null,
      rating: contestRanking?.rating != null ? Math.round(contestRanking.rating) : null,
      contestGlobalRanking: contestRanking?.globalRanking ?? null,
      contestTopPercentage: contestRanking?.topPercentage ?? null,
      raw: { school: user.profile?.school ?? null, totalParticipants: contestRanking?.totalParticipants ?? null },
    };

    const topics = flattenTagCounts(user.tagProblemCounts);

    const contests: NormalizedContest[] = history.map((h, index) => ({
      externalId: h.contest?.title ? slugify(h.contest.title) : `contest-${index}`,
      name: h.contest?.title ?? `Contest ${index + 1}`,
      startTime: h.contest?.startTime ? new Date(h.contest.startTime * 1000) : null,
      url: h.contest?.title ? `https://leetcode.com/contest/${slugify(h.contest.title)}/` : null,
      rank: h.ranking,
      ratingAfter: Math.round(h.rating),
      ratingBefore: null,
      ratingChange: null,
      problemsSolved: h.problemsSolved,
    }));
    // LeetCode reports only the post-contest rating; derive the delta locally.
    for (let i = 1; i < contests.length; i++) {
      const prev = contests[i - 1]!;
      const curr = contests[i]!;
      curr.ratingBefore = prev.ratingAfter ?? null;
      curr.ratingChange = curr.ratingAfter != null && prev.ratingAfter != null ? curr.ratingAfter - prev.ratingAfter : null;
    }

    const ratings: NormalizedRatingPoint[] = history
      .filter((h) => h.contest?.startTime)
      .map((h) => ({
        rating: Math.round(h.rating),
        recordedAt: new Date(h.contest!.startTime * 1000),
        contestName: h.contest!.title,
      }));

    const recentRaw = payload.data?.recentAcSubmissionList ?? null;
    const recentActivity: NormalizedActivity[] = (recentRaw ?? []).map((s) => ({
      title: s.title,
      url: `https://leetcode.com/problems/${s.titleSlug}/`,
      // The recent-submissions feed carries no difficulty or tags.
      difficulty: 'UNKNOWN' as Difficulty,
      topics: [],
      solvedAt: new Date(Number(s.timestamp) * 1000),
    }));

    return {
      profile: this.ok(profile),
      // LeetCode publishes solved *counts*, never the full per-problem list.
      problems: this.notPublic<NormalizedProblem[]>('a per-problem solved list'),
      topics: topics.length > 0 ? this.ok(topics) : this.notPublic<NormalizedTopic[]>('topic breakdowns for this profile'),
      contests: history.length > 0 ? this.ok(contests) : this.notPublic<NormalizedContest[]>('a contest history for this profile'),
      ratings: ratings.length > 0 ? this.ok(ratings) : this.notPublic<NormalizedRatingPoint[]>('a rating history for this profile'),
      ranking: this.ok({
        globalRank: user.profile?.ranking ?? null,
        countryRank: null,
        rankTitle: null,
        topPercentage: contestRanking?.topPercentage ?? null,
      }),
      recentActivity: recentRaw ? this.ok(recentActivity) : this.notPublic<NormalizedActivity[]>('recent submissions for this profile'),
    };
  }
}

export function flattenTagCounts(
  tagCounts: { advanced: LcTagCount[]; intermediate: LcTagCount[]; fundamental: LcTagCount[] } | null | undefined,
): NormalizedTopic[] {
  if (!tagCounts) return [];
  const tally = new Map<string, number>();
  for (const group of [tagCounts.fundamental, tagCounts.intermediate, tagCounts.advanced]) {
    for (const tag of group ?? []) {
      if (!tag || tag.problemsSolved <= 0) continue;
      const topic = normalizeTopic(tag.tagSlug || tag.tagName);
      tally.set(topic, (tally.get(topic) ?? 0) + tag.problemsSolved);
    }
  }
  return [...tally.entries()]
    .map(([topic, problemsSolved]) => ({ topic, problemsSolved }))
    .sort((a, b) => b.problemsSolved - a.problemsSolved);
}

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
