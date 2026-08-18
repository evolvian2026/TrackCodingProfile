import type { Platform } from '@prisma/client';
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

const REST = 'https://www.hackerrank.com/rest/hackers';

interface HrProfileResponse {
  model?: {
    username?: string;
    name?: string;
    country?: string;
    school?: string;
    avatar?: string;
    short_bio?: string;
    level?: number;
    website?: string;
  };
}

interface HrBadge {
  badge_name?: string;
  stars?: number;
  solved?: number;
  total_challenges?: number;
  badge_type?: string;
  category_name?: string;
  hacker_rank?: number;
  score?: number;
}

interface HrBadgesResponse {
  models?: HrBadge[];
}

interface HrCertificate {
  certificates?: string[];
  attempts?: { certificate?: string; status?: string; certificate_image?: string }[];
}

/**
 * HackerRank exposes far less than the other three platforms. Its
 * `/rest/hackers/:username/*` endpoints back the public profile page, but
 * overall solved counts, submission history and contest results are NOT public.
 *
 * This adapter reports exactly what it can see and marks everything else
 * UNAVAILABLE — it never invents a solved count.
 */
export class HackerRankAdapter extends BaseAdapter {
  readonly platform: Platform = 'HACKERRANK';
  readonly label = 'HackerRank';

  buildProfileUrl(username: string): string {
    return platformMeta('HACKERRANK').profileUrl(username);
  }

  protected async load(username: string): Promise<SnapshotParts> {
    const profileRes = await platformRequest<HrProfileResponse>(
      this.platform,
      `${REST}/${encodeURIComponent(username)}/profile`,
      { headers: { referer: this.buildProfileUrl(username) } },
    );

    const model = profileRes.data?.model;
    if (!model?.username) throw new PlatformFetchError('NOT_FOUND', `HackerRank user "${username}" not found`);

    const [badges, certificates] = await Promise.all([
      this.fetchBadges(username).catch(() => null),
      this.fetchCertificates(username).catch(() => null),
    ]);

    const domains = badges ? summarizeDomains(badges) : null;
    const derivedSolved = domains ? domains.reduce((sum, d) => sum + (d.solved ?? 0), 0) : null;
    const totalScore = badges ? sumScores(badges) : null;

    const profile: NormalizedProfile = {
      username: model.username,
      profileUrl: this.buildProfileUrl(model.username),
      displayName: model.name ?? null,
      country: model.country ?? null,
      avatarUrl: model.avatar ?? null,
      // Derived by summing the per-track solved counters HackerRank publishes on
      // badges. Provenance is recorded so the UI can label it as derived.
      totalSolved: derivedSolved,
      problemSolvingScore: totalScore,
      badges: badges ?? undefined,
      certificates: certificates?.certificates ?? undefined,
      domains: domains ?? undefined,
      skills: domains?.map((d) => d.domain) ?? undefined,
      raw: {
        school: model.school ?? null,
        level: model.level ?? null,
        provenance: derivedSolved !== null ? { totalSolved: 'derived:sum-of-public-badge-counters' } : undefined,
      },
    };

    const topics: NormalizedTopic[] = (domains ?? [])
      .filter((d) => d.solved !== null && d.solved > 0)
      .map((d) => ({ topic: normalizeTopic(d.domain), problemsSolved: d.solved! }));

    return {
      profile: this.ok(profile),
      problems: this.notPublic<NormalizedProblem[]>('a per-problem solved list'),
      topics: topics.length > 0 ? this.ok(topics) : this.notPublic<NormalizedTopic[]>('domain breakdowns for this profile'),
      contests: this.notPublic<NormalizedContest[]>('contest results'),
      ratings: this.notPublic<NormalizedRatingPoint[]>('a rating history'),
      ranking: this.notPublic<{ globalRank?: number | null }>('global or country ranking'),
      recentActivity: this.notPublic<NormalizedActivity[]>('a recent-activity feed'),
    };
  }

  private async fetchBadges(username: string): Promise<HrBadge[]> {
    const res = await platformRequest<HrBadgesResponse>(this.platform, `${REST}/${encodeURIComponent(username)}/badges`, {
      headers: { referer: this.buildProfileUrl(username) },
    });
    return res.data?.models ?? [];
  }

  private async fetchCertificates(username: string): Promise<HrCertificate> {
    const res = await platformRequest<HrCertificate>(
      this.platform,
      `${REST}/${encodeURIComponent(username)}/certificates`,
      { headers: { referer: this.buildProfileUrl(username) } },
    );
    return res.data ?? {};
  }
}

export interface HrDomainSummary {
  domain: string;
  stars: number | null;
  solved: number | null;
  totalChallenges: number | null;
  score: number | null;
}

/** Turn HackerRank's badge list into the domain-wise view the dashboard shows. */
export function summarizeDomains(badges: HrBadge[]): HrDomainSummary[] {
  return badges
    .filter((b) => b.badge_name)
    .map((b) => ({
      domain: b.badge_name!,
      stars: b.stars ?? null,
      solved: typeof b.solved === 'number' ? b.solved : null,
      totalChallenges: typeof b.total_challenges === 'number' ? b.total_challenges : null,
      score: typeof b.score === 'number' ? b.score : null,
    }))
    .sort((a, b) => (b.solved ?? 0) - (a.solved ?? 0));
}

function sumScores(badges: HrBadge[]): number | null {
  const scores = badges.map((b) => b.score).filter((s): s is number => typeof s === 'number');
  return scores.length > 0 ? scores.reduce((a, b) => a + b, 0) : null;
}
