import type { SkillLevel } from '@prisma/client';
import type { ScoringTargets, ScoringWeights, SkillThresholds } from '../config/defaults.js';

export interface ScoreInputs {
  totalSolved: number;
  easySolved: number;
  mediumSolved: number;
  hardSolved: number;
  /** Solved problems whose difficulty the platform did not report. */
  unknownSolved: number;
  contestsAttended: number;
  bestRating: number | null;
  distinctTopics: number;
}

export interface ScoreComponent {
  key: keyof ScoringWeights;
  label: string;
  weight: number;
  /** 0-1 achievement against the configured target. */
  achievement: number;
  /** weight * achievement — the points this component contributed. */
  points: number;
  detail: string;
}

export interface ScoreResult {
  score: number;
  components: ScoreComponent[];
  /** Every number used, so the UI can show the calculation openly. */
  inputs: ScoreInputs;
  targets: ScoringTargets;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * The Competitive Programming Score is OUR composite metric, not a platform
 * rating. Each component is a ratio against an administrator-configured target,
 * capped at 100%, then weighted. The full breakdown is returned so the UI can
 * show exactly how the number was produced.
 */
export function calculateScore(inputs: ScoreInputs, weights: ScoringWeights, targets: ScoringTargets): ScoreResult {
  const dp = targets.difficultyPoints;
  const difficultyPoints =
    inputs.easySolved * dp.easy +
    inputs.mediumSolved * dp.medium +
    inputs.hardSolved * dp.hard +
    inputs.unknownSolved * dp.unknown;

  const raw: Omit<ScoreComponent, 'points'>[] = [
    {
      key: 'problemsSolved',
      label: 'Problems Solved',
      weight: weights.problemsSolved,
      achievement: clamp01(safeRatio(inputs.totalSolved, targets.problemsSolvedTarget)),
      detail: `${inputs.totalSolved} solved of ${targets.problemsSolvedTarget} target`,
    },
    {
      key: 'problemDifficulty',
      label: 'Problem Difficulty',
      weight: weights.problemDifficulty,
      achievement: clamp01(safeRatio(difficultyPoints, targets.difficultyPointsTarget)),
      detail: `${round2(difficultyPoints)} difficulty points (E×${dp.easy} + M×${dp.medium} + H×${dp.hard}) of ${targets.difficultyPointsTarget} target`,
    },
    {
      key: 'contestParticipation',
      label: 'Contest Participation',
      weight: weights.contestParticipation,
      achievement: clamp01(safeRatio(inputs.contestsAttended, targets.contestsTarget)),
      detail: `${inputs.contestsAttended} contests of ${targets.contestsTarget} target`,
    },
    {
      key: 'contestRating',
      label: 'Contest Rating',
      weight: weights.contestRating,
      // Ratings start around 800 on every platform, so the floor is subtracted
      // before scaling — otherwise an unrated student would already score ~40%.
      achievement: inputs.bestRating === null ? 0 : clamp01(safeRatio(inputs.bestRating - 800, targets.ratingTarget - 800)),
      detail:
        inputs.bestRating === null
          ? 'No contest rating available on any platform'
          : `Best rating ${inputs.bestRating} against a ${targets.ratingTarget} target`,
    },
    {
      key: 'topicCoverage',
      label: 'Topic Coverage',
      weight: weights.topicCoverage,
      achievement: clamp01(safeRatio(inputs.distinctTopics, targets.topicsTarget)),
      detail: `${inputs.distinctTopics} distinct topics of ${targets.topicsTarget} target`,
    },
  ];

  const totalWeight = raw.reduce((sum, c) => sum + c.weight, 0);
  // Weights are normalized, so an administrator can enter 3/2/1/2/1 or 30/20/…
  const scale = totalWeight > 0 ? 100 / totalWeight : 0;

  const components: ScoreComponent[] = raw.map((c) => ({
    ...c,
    achievement: round2(c.achievement),
    points: round2(c.achievement * c.weight * scale),
  }));

  return {
    score: round2(components.reduce((sum, c) => sum + c.points, 0)),
    components,
    inputs,
    targets,
  };
}

function safeRatio(value: number, target: number): number {
  if (!Number.isFinite(target) || target <= 0) return 0;
  return value / target;
}

export interface SkillInput {
  topic: string;
  problemsSolved: number;
  /** Number of distinct platforms this topic was solved on. */
  platformCount: number;
  /** Whether anything in this topic was solved inside the recency window. */
  recentlyActive: boolean;
}

export interface SkillResult {
  topic: string;
  level: SkillLevel;
  score: number;
  problemsSolved: number;
  platformCount: number;
}

/**
 * Skill level per topic. The raw solved count is boosted for breadth (the same
 * topic practised on several platforms) and for recent activity, then bucketed
 * against administrator-configured thresholds.
 */
export function calculateSkill(input: SkillInput, thresholds: SkillThresholds): SkillResult {
  const diversity = 1 + Math.max(0, input.platformCount - 1) * thresholds.platformDiversityBonus;
  const recency = input.recentlyActive ? 1 + thresholds.recentActivityBonus : 1;
  const score = round2(input.problemsSolved * diversity * recency);

  let level: SkillLevel = 'NONE';
  if (score >= thresholds.expert) level = 'EXPERT';
  else if (score >= thresholds.advanced) level = 'ADVANCED';
  else if (score >= thresholds.intermediate) level = 'INTERMEDIATE';
  else if (score >= thresholds.beginner) level = 'BEGINNER';

  return {
    topic: input.topic,
    level,
    score,
    problemsSolved: input.problemsSolved,
    platformCount: input.platformCount,
  };
}

export const SKILL_LEVEL_ORDER: SkillLevel[] = ['NONE', 'BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'];
