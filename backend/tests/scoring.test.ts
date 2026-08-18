import { describe, expect, it } from 'vitest';
import { calculateScore, calculateSkill, type ScoreInputs } from '../src/services/scoring.js';
import {
  DEFAULT_SCORING_TARGETS,
  DEFAULT_SCORING_WEIGHTS,
  DEFAULT_SKILL_THRESHOLDS,
} from '../src/config/defaults.js';

const base: ScoreInputs = {
  totalSolved: 0,
  easySolved: 0,
  mediumSolved: 0,
  hardSolved: 0,
  unknownSolved: 0,
  contestsAttended: 0,
  bestRating: null,
  distinctTopics: 0,
};

describe('competitive programming score', () => {
  it('scores an empty profile as zero', () => {
    const result = calculateScore(base, DEFAULT_SCORING_WEIGHTS, DEFAULT_SCORING_TARGETS);
    expect(result.score).toBe(0);
  });

  it('caps at 100 when every target is exceeded', () => {
    const result = calculateScore(
      { ...base, totalSolved: 99_999, easySolved: 9_999, mediumSolved: 9_999, hardSolved: 9_999, contestsAttended: 500, bestRating: 3500, distinctTopics: 90 },
      DEFAULT_SCORING_WEIGHTS,
      DEFAULT_SCORING_TARGETS,
    );
    expect(result.score).toBe(100);
  });

  it('normalizes weights that do not sum to 100', () => {
    const inputs = { ...base, totalSolved: DEFAULT_SCORING_TARGETS.problemsSolvedTarget };
    const asPercent = calculateScore(inputs, { problemsSolved: 30, problemDifficulty: 20, contestParticipation: 15, contestRating: 20, topicCoverage: 15 }, DEFAULT_SCORING_TARGETS);
    const asRatio = calculateScore(inputs, { problemsSolved: 6, problemDifficulty: 4, contestParticipation: 3, contestRating: 4, topicCoverage: 3 }, DEFAULT_SCORING_TARGETS);
    expect(asRatio.score).toBeCloseTo(asPercent.score, 5);
  });

  it('subtracts the 800 rating floor so an unrated newcomer does not start halfway', () => {
    const atFloor = calculateScore({ ...base, bestRating: 800 }, DEFAULT_SCORING_WEIGHTS, DEFAULT_SCORING_TARGETS);
    expect(atFloor.components.find((c) => c.key === 'contestRating')!.points).toBe(0);
  });

  it('treats a missing rating as zero achievement, not as a penalty elsewhere', () => {
    const unrated = calculateScore({ ...base, totalSolved: 1100 }, DEFAULT_SCORING_WEIGHTS, DEFAULT_SCORING_TARGETS);
    const ratingComponent = unrated.components.find((c) => c.key === 'contestRating')!;
    expect(ratingComponent.points).toBe(0);
    expect(ratingComponent.detail).toMatch(/No contest rating/);
    // The problems component still earns its full 30.
    expect(unrated.components.find((c) => c.key === 'problemsSolved')!.points).toBe(30);
  });

  it('weights hard problems above easy ones', () => {
    const easy = calculateScore({ ...base, totalSolved: 100, easySolved: 100 }, DEFAULT_SCORING_WEIGHTS, DEFAULT_SCORING_TARGETS);
    const hard = calculateScore({ ...base, totalSolved: 100, hardSolved: 100 }, DEFAULT_SCORING_WEIGHTS, DEFAULT_SCORING_TARGETS);
    expect(hard.score).toBeGreaterThan(easy.score);
  });

  it('exposes every component so the calculation can be shown to the user', () => {
    const result = calculateScore({ ...base, totalSolved: 550 }, DEFAULT_SCORING_WEIGHTS, DEFAULT_SCORING_TARGETS);
    expect(result.components.map((c) => c.key)).toEqual([
      'problemsSolved', 'problemDifficulty', 'contestParticipation', 'contestRating', 'topicCoverage',
    ]);
    const sum = result.components.reduce((total, c) => total + c.points, 0);
    expect(sum).toBeCloseTo(result.score, 1);
  });
});

describe('skill matrix', () => {
  it('buckets by configured thresholds', () => {
    const at = (solved: number) =>
      calculateSkill({ topic: 'Arrays', problemsSolved: solved, platformCount: 1, recentlyActive: false }, DEFAULT_SKILL_THRESHOLDS).level;
    expect(at(0)).toBe('NONE');
    expect(at(5)).toBe('BEGINNER');
    expect(at(20)).toBe('INTERMEDIATE');
    expect(at(50)).toBe('ADVANCED');
    expect(at(120)).toBe('EXPERT');
  });

  it('rewards practising the same topic across several platforms', () => {
    const single = calculateSkill({ topic: 'Graphs', problemsSolved: 40, platformCount: 1, recentlyActive: false }, DEFAULT_SKILL_THRESHOLDS);
    const across = calculateSkill({ topic: 'Graphs', problemsSolved: 40, platformCount: 3, recentlyActive: false }, DEFAULT_SKILL_THRESHOLDS);
    expect(across.score).toBeGreaterThan(single.score);
    expect(across.level).toBe('ADVANCED');
    expect(single.level).toBe('INTERMEDIATE');
  });

  it('rewards recent activity', () => {
    const stale = calculateSkill({ topic: 'Trees', problemsSolved: 30, platformCount: 1, recentlyActive: false }, DEFAULT_SKILL_THRESHOLDS);
    const fresh = calculateSkill({ topic: 'Trees', problemsSolved: 30, platformCount: 1, recentlyActive: true }, DEFAULT_SKILL_THRESHOLDS);
    expect(fresh.score).toBeGreaterThan(stale.score);
  });
});
