import { Platform } from '@prisma/client';

export interface PlatformMeta {
  key: Platform;
  /** Column key used by the Excel importer, e.g. `leetcode_username`. */
  usernameField: string;
  label: string;
  color: string;
  profileUrl: (username: string) => string;
  /** Whether the platform exposes comparable Easy/Medium/Hard buckets. */
  hasDifficultyBreakdown: boolean;
  hasContests: boolean;
  hasTopics: boolean;
  /** Requests per minute we allow ourselves against this platform. */
  defaultRateLimitPerMinute: number;
  docsNote: string;
}

export const PLATFORMS: Record<Platform, PlatformMeta> = {
  LEETCODE: {
    key: 'LEETCODE',
    usernameField: 'leetcode_username',
    label: 'LeetCode',
    color: '#F89F1B',
    profileUrl: (u) => `https://leetcode.com/u/${encodeURIComponent(u)}/`,
    hasDifficultyBreakdown: true,
    hasContests: true,
    hasTopics: true,
    defaultRateLimitPerMinute: 20,
    docsNote: 'Public GraphQL endpoint at https://leetcode.com/graphql (unofficial but publicly served).',
  },
  CODECHEF: {
    key: 'CODECHEF',
    usernameField: 'codechef_username',
    label: 'CodeChef',
    color: '#5B4638',
    profileUrl: (u) => `https://www.codechef.com/users/${encodeURIComponent(u)}`,
    hasDifficultyBreakdown: false,
    hasContests: true,
    hasTopics: false,
    defaultRateLimitPerMinute: 10,
    docsNote: 'No public API. Public profile page is parsed for rating/stars/contest history.',
  },
  HACKERRANK: {
    key: 'HACKERRANK',
    usernameField: 'hackerrank_username',
    label: 'HackerRank',
    color: '#00EA64',
    profileUrl: (u) => `https://www.hackerrank.com/profile/${encodeURIComponent(u)}`,
    hasDifficultyBreakdown: false,
    hasContests: false,
    hasTopics: true,
    defaultRateLimitPerMinute: 10,
    docsNote:
      'Public REST endpoints under /rest/hackers/:username expose badges and scores. Solved counts are generally NOT public.',
  },
  CODEFORCES: {
    key: 'CODEFORCES',
    usernameField: 'codeforces_username',
    label: 'Codeforces',
    color: '#1F8ACB',
    profileUrl: (u) => `https://codeforces.com/profile/${encodeURIComponent(u)}`,
    hasDifficultyBreakdown: true,
    hasContests: true,
    hasTopics: true,
    defaultRateLimitPerMinute: 30,
    docsNote: 'Official public API at https://codeforces.com/apiHelp — always preferred over scraping.',
  },
};

export const ALL_PLATFORMS = Object.keys(PLATFORMS) as Platform[];

export function platformMeta(p: Platform): PlatformMeta {
  return PLATFORMS[p];
}

export function isPlatform(value: string): value is Platform {
  return Object.prototype.hasOwnProperty.call(PLATFORMS, value);
}
