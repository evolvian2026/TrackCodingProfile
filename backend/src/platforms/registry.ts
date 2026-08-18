import type { Platform } from '@prisma/client';
import { env } from '../config/env.js';
import { ALL_PLATFORMS } from '../config/platforms.js';
import { LIVE_ADAPTER_FACTORIES } from './liveFactories.js';
import { MockAdapter } from './mock/mockAdapter.js';
import type { PlatformAdapter } from './types.js';

export type DataSource = 'mock' | 'live';

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

  const adapter = source === 'mock' ? new MockAdapter(platform) : LIVE_ADAPTER_FACTORIES[platform]();
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
