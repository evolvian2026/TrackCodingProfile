import type { Platform } from '@prisma/client';
import { BaseAdapter, type SnapshotParts } from '../base.js';
import { platformRequest } from '../http.js';
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

/**
 * CodeChef publishes no API for user profiles. The public profile page is
 * fetched once and parsed; the contest history comes from the `all_rating`
 * JSON array CodeChef inlines to draw its own rating graph, which is the most
 * stable structured data on the page.
 *
 * Everything here is defensive: any selector that stops matching yields `null`
 * (reported as UNAVAILABLE) rather than a wrong number.
 */
export class CodeChefAdapter extends BaseAdapter {
  readonly platform: Platform = 'CODECHEF';
  readonly label = 'CodeChef';

  buildProfileUrl(username: string): string {
    return platformMeta('CODECHEF').profileUrl(username);
  }

  protected async load(username: string): Promise<SnapshotParts> {
    const res = await platformRequest<string>(this.platform, this.buildProfileUrl(username), {
      accept: 'text',
      headers: { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
    });
    const html = res.data;

    if (/user not found|page not found/i.test(html) && !/rating-number/.test(html)) {
      throw new PlatformFetchError('NOT_FOUND', `CodeChef user "${username}" not found`);
    }

    const parsed = parseCodeChefProfile(html, username);
    if (parsed.rating === null && parsed.problemsSolved === null && parsed.contests.length === 0) {
      throw new PlatformFetchError(
        'UNAVAILABLE',
        'CodeChef profile page returned no recognizable statistics (layout change or private profile)',
      );
    }

    const profile: NormalizedProfile = {
      username,
      profileUrl: this.buildProfileUrl(username),
      displayName: parsed.displayName,
      country: parsed.country,
      avatarUrl: parsed.avatarUrl,
      rating: parsed.rating,
      maxRating: parsed.maxRating,
      globalRank: parsed.globalRank,
      countryRank: parsed.countryRank,
      stars: parsed.stars,
      totalSolved: parsed.problemsSolved,
      contestsAttended: parsed.contests.length > 0 ? parsed.contests.length : null,
      contestRating: parsed.rating,
      rankTitle: parsed.stars,
      raw: { source: 'public-profile-page' },
    };

    const contests: NormalizedContest[] = parsed.contests.map((c) => ({
      externalId: c.code,
      name: c.name,
      startTime: c.date,
      url: `https://www.codechef.com/${c.code}`,
      rank: c.rank,
      ratingBefore: c.ratingBefore,
      ratingAfter: c.rating,
      ratingChange: c.ratingBefore !== null ? c.rating - c.ratingBefore : null,
      problemsSolved: null,
    }));

    const ratings: NormalizedRatingPoint[] = parsed.contests
      .filter((c) => c.date)
      .map((c) => ({ rating: c.rating, recordedAt: c.date!, contestName: c.name }));

    return {
      profile: this.ok(profile),
      problems: this.notPublic<NormalizedProblem[]>('a per-problem solved list'),
      topics: this.notPublic<NormalizedTopic[]>('topic-wise breakdowns'),
      contests: contests.length > 0 ? this.ok(contests) : this.notPublic<NormalizedContest[]>('a contest history for this profile'),
      ratings: ratings.length > 0 ? this.ok(ratings) : this.notPublic<NormalizedRatingPoint[]>('a rating history for this profile'),
      ranking: this.ok({
        globalRank: parsed.globalRank,
        countryRank: parsed.countryRank,
        rankTitle: parsed.stars,
        topPercentage: null,
      }),
      recentActivity: this.notPublic<NormalizedActivity[]>('a recent-activity feed'),
    };
  }
}

export interface CodeChefContestRow {
  code: string;
  name: string;
  rating: number;
  ratingBefore: number | null;
  rank: number | null;
  date: Date | null;
}

export interface ParsedCodeChefProfile {
  displayName: string | null;
  country: string | null;
  avatarUrl: string | null;
  rating: number | null;
  maxRating: number | null;
  globalRank: number | null;
  countryRank: number | null;
  stars: string | null;
  problemsSolved: number | null;
  contests: CodeChefContestRow[];
}

const num = (raw: string | undefined | null): number | null => {
  if (!raw) return null;
  const cleaned = raw.replace(/[,\s]/g, '');
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
};

/** Exported so the parser can be unit-tested against saved HTML fixtures. */
export function parseCodeChefProfile(html: string, username: string): ParsedCodeChefProfile {
  const rating = num(html.match(/class="rating-number"[^>]*>\s*([\d,]+)/i)?.[1]);
  // Lazy and bounded: a greedy gap backtracks into the number itself and
  // captures only its trailing digit.
  const maxRating = num(html.match(/Highest\s*Rating[\s\S]{0,40}?([\d,]+)/i)?.[1]);
  const stars = html.match(/class="rating"[^>]*>\s*(\d+)\s*★/i)?.[1];

  const ranks = [...html.matchAll(/<strong>([\d,]+)<\/strong>\s*<br\s*\/?>\s*(Global|Country)\s*Rank/gi)];
  let globalRank: number | null = null;
  let countryRank: number | null = null;
  for (const match of ranks) {
    if (/global/i.test(match[2]!)) globalRank = num(match[1]);
    else countryRank = num(match[1]);
  }

  const problemsSolved =
    num(html.match(/Total\s*Problems\s*Solved[\s\S]{0,40}?([\d,]+)/i)?.[1]) ??
    num(html.match(/Fully\s*Solved\s*\(\s*([\d,]+)\s*\)/i)?.[1]);

  const displayName = html.match(/<h1[^>]*class="h2-style"[^>]*>\s*([^<]+?)\s*<\/h1>/i)?.[1]?.trim() ?? null;
  const country = html.match(/class="user-country-name"[^>]*>\s*([^<]+?)\s*</i)?.[1]?.trim() ?? null;
  const avatarPath = html.match(/<img[^>]+src="([^"]+)"[^>]*class="[^"]*profileImage/i)?.[1] ?? null;

  return {
    displayName: displayName && displayName.toLowerCase() !== username.toLowerCase() ? displayName : null,
    country,
    avatarUrl: avatarPath,
    rating,
    maxRating,
    globalRank,
    countryRank,
    stars: stars ? `${stars}★` : null,
    problemsSolved,
    contests: parseRatingSeries(html),
  };
}

/**
 * CodeChef inlines `var all_rating = [ {...}, ... ];` to render its rating
 * chart. Each entry carries the contest code, name, rank, rating and date.
 */
export function parseRatingSeries(html: string): CodeChefContestRow[] {
  const match = html.match(/var\s+all_rating\s*=\s*(\[[\s\S]*?\]);/);
  if (!match?.[1]) return [];

  let entries: Record<string, unknown>[];
  try {
    entries = JSON.parse(match[1]) as Record<string, unknown>[];
  } catch {
    return [];
  }

  const rows: CodeChefContestRow[] = [];
  let previousRating: number | null = null;

  for (const entry of entries) {
    const rating = num(String(entry.rating ?? ''));
    if (rating === null) continue;
    const code = String(entry.code ?? entry.contest_code ?? `contest-${rows.length}`);
    rows.push({
      code,
      name: String(entry.name ?? code),
      rating,
      ratingBefore: previousRating,
      rank: num(String(entry.rank ?? '')),
      date: parseCodeChefDate(entry),
    });
    previousRating = rating;
  }
  return rows;
}

function parseCodeChefDate(entry: Record<string, unknown>): Date | null {
  const endDate = entry.end_date ?? entry.getdate;
  if (typeof endDate === 'string') {
    const parsed = new Date(endDate.replace(' ', 'T') + (endDate.includes('T') ? '' : 'Z'));
    if (Number.isFinite(parsed.getTime())) return parsed;
  }
  const year = Number(entry.getyear);
  const month = Number(entry.getmonth);
  const day = Number(entry.getday);
  if ([year, month, day].every(Number.isFinite)) return new Date(Date.UTC(year, month - 1, day));
  return null;
}
