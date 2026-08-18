import { ALL_PLATFORMS, PLATFORMS } from './platforms.js';
import { env } from './env.js';
import type { Platform } from '@prisma/client';

/**
 * Weights for the Competitive Programming Score (0-100). This is OUR score,
 * not an official platform metric — the UI always labels it as such.
 * Every weight is administrator-configurable at runtime via app settings.
 */
export interface ScoringWeights {
  problemsSolved: number;
  problemDifficulty: number;
  contestParticipation: number;
  contestRating: number;
  topicCoverage: number;
}

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  problemsSolved: 30,
  problemDifficulty: 20,
  contestParticipation: 15,
  contestRating: 20,
  topicCoverage: 15,
};

/** Reference points at which a component of the score saturates at 100%. */
export interface ScoringTargets {
  /** Solved count that earns full marks on the "problems solved" component. */
  problemsSolvedTarget: number;
  /** Weighted difficulty points that earn full marks. */
  difficultyPointsTarget: number;
  /** Contests attended that earn full marks. */
  contestsTarget: number;
  /** Rating that earns full marks on the rating component. */
  ratingTarget: number;
  /** Distinct topics that earn full marks. */
  topicsTarget: number;
  /** Points awarded per solved problem, by difficulty. */
  difficultyPoints: { easy: number; medium: number; hard: number; unknown: number };
}

export const DEFAULT_SCORING_TARGETS: ScoringTargets = {
  problemsSolvedTarget: 600,
  difficultyPointsTarget: 1200,
  contestsTarget: 40,
  ratingTarget: 2000,
  topicsTarget: 25,
  difficultyPoints: { easy: 1, medium: 3, hard: 6, unknown: 1.5 },
};

export interface SkillThresholds {
  beginner: number;
  intermediate: number;
  advanced: number;
  expert: number;
  /** Bonus multiplier applied per additional platform the topic appears on. */
  platformDiversityBonus: number;
  /** Bonus multiplier when the student solved something in this topic recently. */
  recentActivityBonus: number;
  recentActivityWindowDays: number;
}

export const DEFAULT_SKILL_THRESHOLDS: SkillThresholds = {
  beginner: 5,
  intermediate: 20,
  advanced: 50,
  expert: 120,
  platformDiversityBonus: 0.15,
  recentActivityBonus: 0.1,
  recentActivityWindowDays: 30,
};

export interface ProcessingLimits {
  /** Worker concurrency across all platforms. */
  concurrency: number;
  maxRetries: number;
  /** Base delay for exponential backoff, in milliseconds. */
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  /** Extra random delay (0..N ms) added to every outbound request. */
  jitterMs: number;
  requestTimeoutMs: number;
  perPlatformRatePerMinute: Record<Platform, number>;
}

export const DEFAULT_PROCESSING_LIMITS: ProcessingLimits = {
  concurrency: env.QUEUE_CONCURRENCY,
  maxRetries: env.MAX_RETRIES,
  retryBaseDelayMs: 1_000,
  retryMaxDelayMs: 60_000,
  jitterMs: 400,
  requestTimeoutMs: env.HTTP_TIMEOUT_MS,
  perPlatformRatePerMinute: Object.fromEntries(
    ALL_PLATFORMS.map((p) => [p, PLATFORMS[p].defaultRateLimitPerMinute]),
  ) as Record<Platform, number>,
};

export interface CacheSettings {
  /** How long a successful platform fetch stays fresh. */
  ttlMinutes: number;
  /** Shorter TTL for failures so a transient error is retried sooner. */
  errorTtlMinutes: number;
}

export const DEFAULT_CACHE_SETTINGS: CacheSettings = {
  ttlMinutes: env.CACHE_TTL_MINUTES,
  errorTtlMinutes: 30,
};

export const DEFAULT_PLATFORM_COLORS: Record<Platform, string> = Object.fromEntries(
  ALL_PLATFORMS.map((p) => [p, PLATFORMS[p].color]),
) as Record<Platform, string>;

export const SETTING_KEYS = {
  scoringWeights: 'scoring.weights',
  scoringTargets: 'scoring.targets',
  skillThresholds: 'skills.thresholds',
  processingLimits: 'processing.limits',
  cache: 'cache.settings',
  platformColors: 'ui.platformColors',
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

export const SETTING_DEFAULTS: Record<SettingKey, unknown> = {
  [SETTING_KEYS.scoringWeights]: DEFAULT_SCORING_WEIGHTS,
  [SETTING_KEYS.scoringTargets]: DEFAULT_SCORING_TARGETS,
  [SETTING_KEYS.skillThresholds]: DEFAULT_SKILL_THRESHOLDS,
  [SETTING_KEYS.processingLimits]: DEFAULT_PROCESSING_LIMITS,
  [SETTING_KEYS.cache]: DEFAULT_CACHE_SETTINGS,
  [SETTING_KEYS.platformColors]: DEFAULT_PLATFORM_COLORS,
};
