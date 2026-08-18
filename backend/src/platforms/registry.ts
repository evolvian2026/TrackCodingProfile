import type { Platform } from '@prisma/client';
import { env } from '../config/env.js';
import { ALL_PLATFORMS } from '../config/platforms.js';
import { CodeChefAdapter } from './codechef/adapter.js';
import { CodeforcesAdapter } from './codeforces/adapter.js';
import { HackerRankAdapter } from './hackerrank/adapter.js';
import { LeetCodeAdapter } from './leetcode/adapter.js';
import { MockAdapter } from './mock/mockAdapter.js';
import type { PlatformAdapter } from './types.js';

export type DataSource = 'mock' | 'live';

const liveFactories: Record<Platform, () => PlatformAdapter> = {
  LEETCODE: () => new LeetCodeAdapter(),
  CODECHEF: () => new CodeChefAdapter(),
  HACKERRANK: () => new HackerRankAdapter(),
  CODEFORCES: () => new CodeforcesAdapter(),
};

const instances = new Map<string, PlatformAdapter>();

/**
 * Single place that decides which implementation serves a platform.
 * Adding a new platform means: add it to the `Platform` enum, write an adapter,
 * register it here. Nothing else in the application changes.
 */
export function getAdapter(platform: Platform, source: DataSource = env.DATA_SOURCE): PlatformAdapter {
  const key = `${source}:${platform}`;
  const existing = instances.get(key);
  if (existing) return existing;

  const adapter = source === 'mock' ? new MockAdapter(platform) : liveFactories[platform]();
  instances.set(key, adapter);
  return adapter;
}

export function getAllAdapters(source: DataSource = env.DATA_SOURCE): PlatformAdapter[] {
  return ALL_PLATFORMS.map((p) => getAdapter(p, source));
}

/** Test helper — clears memoized adapters. */
export function resetAdapters() {
  instances.clear();
}
