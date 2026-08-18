import type { Platform } from '@prisma/client';
import { CodeChefAdapter } from './codechef/adapter.js';
import { CodeforcesAdapter } from './codeforces/adapter.js';
import { HackerRankAdapter } from './hackerrank/adapter.js';
import { LeetCodeAdapter } from './leetcode/adapter.js';
import type { PlatformAdapter } from './types.js';

/**
 * The single map of platform -> real implementation. Registering a new platform
 * here (plus an entry in the `Platform` enum and a `PLATFORMS` entry) is all it
 * takes to add AtCoder, GeeksforGeeks, HackerEarth, …
 */
export const LIVE_ADAPTER_FACTORIES: Record<Platform, () => PlatformAdapter> = {
  LEETCODE: () => new LeetCodeAdapter(),
  CODECHEF: () => new CodeChefAdapter(),
  HACKERRANK: () => new HackerRankAdapter(),
  CODEFORCES: () => new CodeforcesAdapter(),
};
