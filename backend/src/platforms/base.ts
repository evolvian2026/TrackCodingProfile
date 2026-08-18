import type { DataStatus, Platform } from '@prisma/client';
import { logger } from '../lib/logger.js';
import { readCache, writeCache } from './cache.js';
import {
  PlatformFetchError,
  available,
  unavailable,
  type NormalizedActivity,
  type NormalizedContest,
  type NormalizedProblem,
  type NormalizedProfile,
  type NormalizedRanking,
  type NormalizedRatingPoint,
  type NormalizedTopic,
  type PlatformAdapter,
  type PlatformResult,
  type PlatformSnapshot,
} from './types.js';

export interface SnapshotParts {
  profile: PlatformResult<NormalizedProfile>;
  problems: PlatformResult<NormalizedProblem[]>;
  topics: PlatformResult<NormalizedTopic[]>;
  contests: PlatformResult<NormalizedContest[]>;
  ratings: PlatformResult<NormalizedRatingPoint[]>;
  ranking: PlatformResult<NormalizedRanking>;
  recentActivity: PlatformResult<NormalizedActivity[]>;
}

export interface FetchOptions {
  /** Skip the response cache and go straight to the platform. */
  force?: boolean;
}

/**
 * Shared adapter behaviour: one network pass per student, response caching,
 * and uniform error → DataStatus translation. Concrete adapters only implement
 * `load()` plus the small amount of platform-specific parsing it needs.
 */
export abstract class BaseAdapter implements PlatformAdapter {
  abstract readonly platform: Platform;
  abstract readonly label: string;

  /** Does the real work for one username. May throw `PlatformFetchError`. */
  protected abstract load(username: string): Promise<SnapshotParts>;

  abstract buildProfileUrl(username: string): string;

  normalizeUsername(input: string): string {
    const trimmed = (input ?? '').trim();
    if (!trimmed) return '';
    if (!/^https?:\/\//i.test(trimmed)) return trimmed.replace(/^@/, '').replace(/\/+$/, '');
    try {
      const url = new URL(trimmed);
      const segments = url.pathname.split('/').filter(Boolean);
      return decodeURIComponent(segments[segments.length - 1] ?? '');
    } catch {
      return trimmed;
    }
  }

  validateUsername(username: string): { valid: boolean; reason?: string } {
    const u = this.normalizeUsername(username);
    if (!u) return { valid: false, reason: 'Username is empty' };
    if (u.length > 64) return { valid: false, reason: 'Username is unrealistically long' };
    if (!/^[A-Za-z0-9._@+-]+$/.test(u)) return { valid: false, reason: 'Username contains unsupported characters' };
    return { valid: true };
  }

  async fetchAll(rawUsername: string, options: FetchOptions = {}): Promise<PlatformSnapshot> {
    const started = Date.now();
    const username = this.normalizeUsername(rawUsername);
    const profileUrl = this.buildProfileUrl(username);

    const validation = this.validateUsername(username);
    if (!validation.valid) {
      return this.buildSnapshot(username, profileUrl, this.allFailed('NOT_FOUND', validation.reason!), started);
    }

    if (!options.force) {
      const cached = await readCache<SnapshotParts>(this.platform, username);
      if (cached) {
        const parts = reviveParts(cached.payload);
        markCached(parts);
        const snapshot = this.buildSnapshot(username, profileUrl, parts, started);
        snapshot.fetchedAt = cached.fetchedAt;
        return snapshot;
      }
    }

    let parts: SnapshotParts;
    try {
      parts = await this.load(username);
    } catch (err) {
      const { status, message } = toDataStatus(err);
      logger.debug(`${this.platform} fetch failed for ${username}: ${message}`);
      parts = this.allFailed(status, message);
    }

    await writeCache(this.platform, username, parts, parts.profile.status);
    return this.buildSnapshot(username, profileUrl, parts, started);
  }

  // -- granular accessors from the shared contract ---------------------------
  async getProfile(username: string) {
    return (await this.fetchAll(username)).profile;
  }
  async getSolvedProblems(username: string) {
    return (await this.fetchAll(username)).problems;
  }
  async getProblemTopics(username: string) {
    return (await this.fetchAll(username)).topics;
  }
  async getContests(username: string) {
    return (await this.fetchAll(username)).contests;
  }
  async getRatings(username: string) {
    return (await this.fetchAll(username)).ratings;
  }
  async getRanking(username: string) {
    return (await this.fetchAll(username)).ranking;
  }
  async getRecentActivity(username: string) {
    return (await this.fetchAll(username)).recentActivity;
  }

  // -- helpers ---------------------------------------------------------------
  protected allFailed(status: DataStatus, message: string): SnapshotParts {
    return {
      profile: unavailable(status, message),
      problems: unavailable(status, message),
      topics: unavailable(status, message),
      contests: unavailable(status, message),
      ratings: unavailable(status, message),
      ranking: unavailable(status, message),
      recentActivity: unavailable(status, message),
    };
  }

  /** For data a platform simply does not publish — distinct from an error. */
  protected notPublic<T>(what: string): PlatformResult<T> {
    return unavailable<T>('UNAVAILABLE', `${this.label} does not publicly expose ${what}`);
  }

  protected ok<T>(data: T): PlatformResult<T> {
    return available(data);
  }

  private buildSnapshot(
    username: string,
    profileUrl: string,
    parts: SnapshotParts,
    started: number,
  ): PlatformSnapshot {
    return {
      platform: this.platform,
      username,
      profileUrl,
      ...parts,
      status: parts.profile.status,
      statusMessage: parts.profile.message,
      fetchedAt: new Date(),
      durationMs: Date.now() - started,
    };
  }
}

export function toDataStatus(err: unknown): { status: DataStatus; message: string } {
  if (err instanceof PlatformFetchError) return { status: err.status, message: err.message };
  const message = err instanceof Error ? err.message : String(err);
  return { status: 'ERROR', message };
}

function markCached(parts: SnapshotParts) {
  for (const value of Object.values(parts)) (value as PlatformResult<unknown>).cached = true;
}

/** JSON round-trips turn Dates into strings; put them back. */
function reviveParts(parts: SnapshotParts): SnapshotParts {
  const revived = structuredClone(parts);
  for (const p of revived.problems.data ?? []) p.solvedAt = toDate(p.solvedAt);
  for (const c of revived.contests.data ?? []) c.startTime = toDate(c.startTime);
  for (const r of revived.ratings.data ?? []) r.recordedAt = toDate(r.recordedAt) ?? new Date(0);
  for (const a of revived.recentActivity.data ?? []) a.solvedAt = toDate(a.solvedAt);
  return revived;
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(value as string);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}
