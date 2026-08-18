import type { DataStatus, Difficulty, Platform } from '@prisma/client';

/**
 * Every adapter returns data wrapped in this envelope. There is no "0 means we
 * did not get it" — an absent number stays absent and the status explains why.
 */
export interface PlatformResult<T> {
  status: DataStatus;
  data?: T;
  message?: string;
  /** True when the value came from the response cache rather than the network. */
  cached?: boolean;
}

export function available<T>(data: T, cached = false): PlatformResult<T> {
  return { status: 'AVAILABLE', data, cached };
}

export function unavailable<T>(status: DataStatus, message: string): PlatformResult<T> {
  return { status, message };
}

/** Normalized profile — the union of what the four platforms can expose. */
export interface NormalizedProfile {
  username: string;
  profileUrl: string;
  displayName?: string | null;
  country?: string | null;
  avatarUrl?: string | null;

  rating?: number | null;
  maxRating?: number | null;
  rankTitle?: string | null;
  maxRankTitle?: string | null;
  globalRank?: number | null;
  countryRank?: number | null;
  stars?: string | null;
  reputation?: number | null;
  contribution?: number | null;
  friendCount?: number | null;

  totalSolved?: number | null;
  easySolved?: number | null;
  mediumSolved?: number | null;
  hardSolved?: number | null;
  problemsAttempted?: number | null;
  totalSubmissions?: number | null;
  acceptedSubmissions?: number | null;
  acceptanceRate?: number | null;

  contestsAttended?: number | null;
  contestRating?: number | null;
  contestGlobalRanking?: number | null;
  contestTopPercentage?: number | null;

  problemSolvingScore?: number | null;
  badges?: unknown;
  certificates?: unknown;
  skills?: unknown;
  domains?: unknown;
  raw?: unknown;
}

export interface NormalizedProblem {
  externalId: string;
  name: string;
  url?: string | null;
  difficulty: Difficulty;
  topics: string[];
  points?: number | null;
  solvedAt?: Date | null;
}

export interface NormalizedTopic {
  topic: string;
  problemsSolved: number;
}

export interface NormalizedContest {
  externalId: string;
  name: string;
  startTime?: Date | null;
  url?: string | null;
  rank?: number | null;
  ratingBefore?: number | null;
  ratingAfter?: number | null;
  ratingChange?: number | null;
  problemsSolved?: number | null;
}

export interface NormalizedRatingPoint {
  rating: number;
  recordedAt: Date;
  contestName?: string | null;
}

export interface NormalizedRanking {
  globalRank?: number | null;
  countryRank?: number | null;
  rankTitle?: string | null;
  topPercentage?: number | null;
}

export interface NormalizedActivity {
  title: string;
  url?: string | null;
  difficulty: Difficulty;
  topics: string[];
  solvedAt?: Date | null;
}

/** Everything one adapter can produce for one student, in one pass. */
export interface PlatformSnapshot {
  platform: Platform;
  username: string;
  profileUrl: string;
  profile: PlatformResult<NormalizedProfile>;
  problems: PlatformResult<NormalizedProblem[]>;
  topics: PlatformResult<NormalizedTopic[]>;
  contests: PlatformResult<NormalizedContest[]>;
  ratings: PlatformResult<NormalizedRatingPoint[]>;
  ranking: PlatformResult<NormalizedRanking>;
  recentActivity: PlatformResult<NormalizedActivity[]>;
  /** Overall status for the profile as a whole — drives `platform_profiles.status`. */
  status: DataStatus;
  statusMessage?: string;
  fetchedAt: Date;
  durationMs: number;
}

/**
 * The contract every platform integration implements. Adding AtCoder,
 * GeeksforGeeks, HackerEarth, … means writing one of these and registering it —
 * nothing else in the application changes.
 */
export interface PlatformAdapter {
  readonly platform: Platform;
  readonly label: string;

  /** Reject obviously invalid handles before spending a network request. */
  validateUsername(username: string): { valid: boolean; reason?: string };
  /** Accepts a bare username or a full profile URL and returns the bare username. */
  normalizeUsername(input: string): string;
  buildProfileUrl(username: string): string;

  getProfile(username: string): Promise<PlatformResult<NormalizedProfile>>;
  getSolvedProblems(username: string): Promise<PlatformResult<NormalizedProblem[]>>;
  getProblemTopics(username: string): Promise<PlatformResult<NormalizedTopic[]>>;
  getContests(username: string): Promise<PlatformResult<NormalizedContest[]>>;
  getRatings(username: string): Promise<PlatformResult<NormalizedRatingPoint[]>>;
  getRanking(username: string): Promise<PlatformResult<NormalizedRanking>>;
  getRecentActivity(username: string): Promise<PlatformResult<NormalizedActivity[]>>;

  /** Fetch everything in one coordinated pass (adapters may share one request). */
  fetchAll(username: string, options?: FetchOptions): Promise<PlatformSnapshot>;
}

export interface FetchOptions {
  /** Skip the response cache and go straight to the platform. */
  force?: boolean;
}

/** Thrown inside adapters; carries the DataStatus that should be persisted. */
export class PlatformFetchError extends Error {
  constructor(
    readonly status: DataStatus,
    message: string,
    readonly retryable = false,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'PlatformFetchError';
  }
}

export const isRetryableStatus = (status: DataStatus) => status === 'RATE_LIMITED' || status === 'UNAVAILABLE';
