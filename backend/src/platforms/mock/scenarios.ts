import type { DataStatus } from '@prisma/client';

export type PerformanceTier = 'elite' | 'high' | 'average' | 'beginner' | 'inactive';

export interface MockScenario {
  /** Non-AVAILABLE means the adapter reports a failure instead of data. */
  status: DataStatus;
  message?: string;
  tier: PerformanceTier;
}

/**
 * Mock mode is driven entirely by the username, so seed data and manual testing
 * can exercise every branch (missing profile, private profile, rate limiting,
 * upstream errors) without any special configuration.
 *
 *   alice_notfound     -> NOT_FOUND
 *   bob_private        -> PRIVATE
 *   carol_ratelimited  -> RATE_LIMITED
 *   dave_error         -> ERROR
 *   erin_unavailable   -> UNAVAILABLE
 *   frank_elite        -> AVAILABLE, elite numbers
 */
const STATUS_MARKERS: [RegExp, DataStatus, string][] = [
  [/not[-_]?found|missing|ghost/i, 'NOT_FOUND', 'Profile does not exist on this platform'],
  [/private|hidden/i, 'PRIVATE', 'Profile is private — statistics are not publicly visible'],
  [/rate[-_]?limit(ed)?|throttled/i, 'RATE_LIMITED', 'Platform rate limit hit; the profile will be retried'],
  [/unavailable|maintenance|down/i, 'UNAVAILABLE', 'Platform temporarily unavailable'],
  [/[-_]error|broken|fail/i, 'ERROR', 'Unexpected response from the platform'],
];

const TIER_MARKERS: [RegExp, PerformanceTier][] = [
  [/elite|topper|star/i, 'elite'],
  [/pro|high|ace/i, 'high'],
  [/beginner|newbie|fresher/i, 'beginner'],
  [/inactive|dormant/i, 'inactive'],
];

export function resolveScenario(username: string): MockScenario {
  for (const [pattern, status, message] of STATUS_MARKERS) {
    if (pattern.test(username)) return { status, message, tier: 'average' };
  }
  for (const [pattern, tier] of TIER_MARKERS) {
    if (pattern.test(username)) return { status: 'AVAILABLE', tier };
  }
  return { status: 'AVAILABLE', tier: 'average' };
}

/**
 * Per-platform ranges. A student is usually active on 2-4 platforms, so the
 * aggregate a tier produces is roughly these numbers multiplied by that count —
 * the ranges are chosen so the totals stay in a believable range.
 */
export const TIER_PROFILE: Record<PerformanceTier, { solvedRange: [number, number]; ratingRange: [number, number]; contestRange: [number, number] }> = {
  elite: { solvedRange: [300, 700], ratingRange: [1900, 2450], contestRange: [25, 60] },
  high: { solvedRange: [180, 400], ratingRange: [1600, 1950], contestRange: [15, 35] },
  average: { solvedRange: [70, 180], ratingRange: [1250, 1600], contestRange: [5, 20] },
  beginner: { solvedRange: [10, 70], ratingRange: [900, 1250], contestRange: [0, 6] },
  inactive: { solvedRange: [0, 12], ratingRange: [800, 950], contestRange: [0, 2] },
};
