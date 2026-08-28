import { describe, expect, it } from 'vitest';
import {
  METRIC_LABELS,
  daysUntil,
  describeScope,
  outcomeFor,
  readMetric,
  requiredPerWeek,
} from '../src/services/goals.service.js';

const NOW = new Date('2026-08-20T12:00:00Z');
const inDays = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

/** A student everything is knowable for, used as the baseline for each case. */
const complete = {
  totalSolved: 150,
  totalContests: 6,
  cpScore: 62.5,
  currentRating: 1580,
  topicCount: 24,
  hasData: true,
  contestsKnown: true,
  topicsKnown: true,
};

describe('reading a metric off a student', () => {
  it('reads every metric the analytics layer records', () => {
    expect(readMetric(complete, 'PROBLEMS_SOLVED')).toEqual({ value: 150, known: true });
    expect(readMetric(complete, 'CONTESTS_ATTENDED')).toEqual({ value: 6, known: true });
    expect(readMetric(complete, 'CP_SCORE')).toEqual({ value: 62.5, known: true });
    expect(readMetric(complete, 'CONTEST_RATING')).toEqual({ value: 1580, known: true });
    expect(readMetric(complete, 'TOPICS_COVERED')).toEqual({ value: 24, known: true });
  });

  it('reports an unpublished metric as unknown rather than zero', () => {
    const hackerRankOnly = { ...complete, contestsKnown: false, topicsKnown: false, totalContests: 0, topicCount: 0 };
    expect(readMetric(hackerRankOnly, 'CONTESTS_ATTENDED')).toEqual({ value: null, known: false });
    expect(readMetric(hackerRankOnly, 'TOPICS_COVERED')).toEqual({ value: null, known: false });
    // The solved count is still real, so it is still a number.
    expect(readMetric(hackerRankOnly, 'PROBLEMS_SOLVED')).toEqual({ value: 150, known: true });
  });

  it('treats an absent rating as unknown, not as a rating of zero', () => {
    expect(readMetric({ ...complete, currentRating: null }, 'CONTEST_RATING')).toEqual({ value: null, known: false });
  });

  it('reports every metric as unknown when nothing was ever retrieved', () => {
    const nothing = { ...complete, hasData: false };
    for (const metric of Object.keys(METRIC_LABELS) as (keyof typeof METRIC_LABELS)[]) {
      expect(readMetric(nothing, metric).known).toBe(false);
    }
  });
});

describe('measuring a student against a target', () => {
  it('meets a target on the nose', () => {
    expect(outcomeFor(complete, 'PROBLEMS_SOLVED', 150)).toEqual({ outcome: 'MET', value: 150, remaining: 0 });
  });

  it('reports the shortfall when behind', () => {
    expect(outcomeFor(complete, 'PROBLEMS_SOLVED', 200)).toEqual({ outcome: 'BEHIND', value: 150, remaining: 50 });
  });

  it('never marks a student behind on a metric their platforms do not publish', () => {
    const noContests = { ...complete, contestsKnown: false, totalContests: 0 };
    const result = outcomeFor(noContests, 'CONTESTS_ATTENDED', 3);
    expect(result.outcome).toBe('UNKNOWN');
    // The distinction that matters: not BEHIND with a remaining of 3.
    expect(result.remaining).toBeNull();
    expect(result.value).toBeNull();
  });

  it('separates "we have no data at all" from "this metric is not published"', () => {
    expect(outcomeFor({ ...complete, hasData: false }, 'PROBLEMS_SOLVED', 10).outcome).toBe('NO_DATA');
    expect(outcomeFor({ ...complete, topicsKnown: false }, 'TOPICS_COVERED', 10).outcome).toBe('UNKNOWN');
    expect(outcomeFor(null, 'PROBLEMS_SOLVED', 10).outcome).toBe('NO_DATA');
  });

  it('does not report a negative shortfall for a student past the target', () => {
    expect(outcomeFor(complete, 'PROBLEMS_SOLVED', 100).remaining).toBe(0);
  });
});

describe('required pace', () => {
  it('states what is left per week', () => {
    // 60 to go over 28 days is 15 a week.
    expect(requiredPerWeek(60, inDays(28), NOW)).toBe(15);
  });

  it('rounds to one decimal rather than pretending to precision', () => {
    expect(requiredPerWeek(10, inDays(9), NOW)).toBe(7.8);
  });

  it('stops answering once the deadline has passed', () => {
    expect(requiredPerWeek(60, inDays(-1), NOW)).toBeNull();
    expect(requiredPerWeek(60, NOW, NOW)).toBeNull();
  });

  it('asks for nothing when the target is already met', () => {
    expect(requiredPerWeek(0, inDays(14), NOW)).toBe(0);
  });
});

describe('the goal window', () => {
  it('counts whole days remaining', () => {
    expect(daysUntil(inDays(10), NOW)).toBe(10);
  });

  it('goes negative once overdue, so an overdue goal cannot look current', () => {
    expect(daysUntil(inDays(-3), NOW)).toBe(-3);
  });
});

describe('describing who a goal applies to', () => {
  const empty = { university: null, college: null, batch: null, branch: null, section: null };

  it('says so plainly when a goal applies to everyone', () => {
    expect(describeScope(empty)).toBe('Everyone');
  });

  it('names every level of the scope that is set', () => {
    expect(describeScope({ ...empty, batch: '2023-26', branch: 'CSE' })).toBe('2023-26 · CSE');
  });
});
