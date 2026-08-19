import { Platform } from '@prisma/client';

export interface PlatformColors {
  light: string;
  dark: string;
}

export interface PlatformMeta {
  key: Platform;
  /** Column key used by the Excel importer, e.g. `leetcode_username`. */
  usernameField: string;
  label: string;
  /**
   * Chart colours, one step per theme.
   *
   * These are NOT the platforms' marketing hex values. Those fail the
   * accessibility gates when used as a chart palette: LeetCode's orange and
   * HackerRank's green are far too light to sit on a white surface, and
   * CodeChef's brown reads as gray. These are re-stepped hues that keep each
   * platform recognisable while clearing the colour-blind separation, chroma
   * and contrast checks in both themes. An administrator can override them.
   */
  colors: PlatformColors;
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
    colors: { light: '#EB6834', dark: '#D95926' },
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
    colors: { light: '#4A3AA7', dark: '#9085E9' },
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
    colors: { light: '#1BAF7A', dark: '#199E70' },
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
    colors: { light: '#2A78D6', dark: '#3987E5' },
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
