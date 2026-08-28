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

/**
 * Calibrated so a strong final-year student (~900 solved, ~40 contests, ~1750
 * rating, ~18 topics across platforms) lands in the high 70s rather than
 * pinning at 100 — otherwise the top of the leaderboard stops discriminating.
 */
export const DEFAULT_SCORING_TARGETS: ScoringTargets = {
  problemsSolvedTarget: 1100,
  difficultyPointsTarget: 2200,
  contestsTarget: 55,
  ratingTarget: 2100,
  topicsTarget: 28,
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

/** One chart colour per platform per theme; administrator-overridable. */
export const DEFAULT_PLATFORM_COLORS: Record<Platform, { light: string; dark: string }> = Object.fromEntries(
  ALL_PLATFORMS.map((p) => [p, { ...PLATFORMS[p].colors }]),
) as Record<Platform, { light: string; dark: string }>;

/**
 * When the application refreshes every profile on its own.
 *
 * The historical snapshots that power growth charts and the inactivity rules
 * only accumulate when a refresh actually runs, so leaving this to someone
 * remembering to click a button quietly starves both features.
 */
export interface RefreshSchedule {
  enabled: boolean;
  frequency: 'daily' | 'weekly';
  /** 0 = Sunday. Only meaningful when frequency is 'weekly'. */
  dayOfWeek: number;
  hour: number;
  minute: number;
  /** IANA zone, so "2am" means 2am where the institution is. */
  timezone: string;
  /** Re-fetch even profiles still inside the cache window. */
  force: boolean;
  /**
   * How late a missed slot may still run. After an outage longer than this the
   * slot is recorded as skipped rather than firing at an unexpected hour.
   */
  graceMinutes: number;
}

export const DEFAULT_REFRESH_SCHEDULE: RefreshSchedule = {
  enabled: false,
  frequency: 'weekly',
  dayOfWeek: 0,
  hour: 2,
  minute: 0,
  timezone: 'Asia/Kolkata',
  force: false,
  graceMinutes: 720,
};

/**
 * Thresholds for the "needs attention" list.
 *
 * Every rule is measured over observed snapshots. A student is never blamed for
 * inactivity we cannot actually see — if the data is too stale to judge, the
 * alert raised is STALE_DATA, which is the administrator's problem.
 */
export interface AlertRules {
  enabled: boolean;
  /** Window over which progress is judged. */
  inactivityDays: number;
  /** Solved-count increase at or below this over the window counts as stalled. */
  minProgressSolved: number;
  /** Drop from the window's peak rating that counts as a decline. */
  ratingDropThreshold: number;
  /** Days without entering a contest before it is worth flagging. */
  contestInactivityDays: number;
  /** A successful fetch older than this makes activity unjudgeable. */
  staleDataDays: number;
  /** How long a handle may keep failing before it is probably wrong. */
  brokenProfileDays: number;
  /** Rules that are switched off entirely. */
  mutedTypes: string[];
}

export const DEFAULT_ALERT_RULES: AlertRules = {
  enabled: true,
  inactivityDays: 21,
  minProgressSolved: 0,
  ratingDropThreshold: 100,
  contestInactivityDays: 60,
  staleDataDays: 14,
  brokenProfileDays: 7,
  mutedTypes: [],
};

export const SETTING_KEYS = {
  scoringWeights: 'scoring.weights',
  scoringTargets: 'scoring.targets',
  skillThresholds: 'skills.thresholds',
  processingLimits: 'processing.limits',
  cache: 'cache.settings',
  platformColors: 'ui.platformColors',
  refreshSchedule: 'processing.schedule',
  alertRules: 'alerts.rules',
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

export const SETTING_DEFAULTS: Record<SettingKey, unknown> = {
  [SETTING_KEYS.scoringWeights]: DEFAULT_SCORING_WEIGHTS,
  [SETTING_KEYS.scoringTargets]: DEFAULT_SCORING_TARGETS,
  [SETTING_KEYS.skillThresholds]: DEFAULT_SKILL_THRESHOLDS,
  [SETTING_KEYS.processingLimits]: DEFAULT_PROCESSING_LIMITS,
  [SETTING_KEYS.cache]: DEFAULT_CACHE_SETTINGS,
  [SETTING_KEYS.platformColors]: DEFAULT_PLATFORM_COLORS,
  [SETTING_KEYS.refreshSchedule]: DEFAULT_REFRESH_SCHEDULE,
  [SETTING_KEYS.alertRules]: DEFAULT_ALERT_RULES,
};
