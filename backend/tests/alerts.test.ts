import { describe, expect, it } from 'vitest';
import { evaluateRules } from '../src/services/alerts.service.js';
import { DEFAULT_ALERT_RULES, type AlertRules } from '../src/config/defaults.js';

const NOW = new Date('2026-08-20T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const rules = (overrides: Partial<AlertRules> = {}): AlertRules => ({ ...DEFAULT_ALERT_RULES, ...overrides });

interface SnapshotSpec {
  daysAgo: number;
  totalSolved?: number | null;
  rating?: number | null;
  contestsAttended?: number | null;
}

const snap = (specs: SnapshotSpec[]) =>
  specs.map((s) => ({
    capturedAt: daysAgo(s.daysAgo),
    totalSolved: s.totalSolved ?? null,
    rating: s.rating ?? null,
    contestsAttended: s.contestsAttended ?? null,
  }));

/** A healthy student, fetched recently, used as the baseline for each case. */
const base = {
  rules: rules(),
  now: NOW,
  hasHandles: true,
  availableProfiles: 2,
  brokenProfiles: [] as { platform: string; status: string; lastSuccessAt: Date | null }[],
  lastSuccessAt: daysAgo(1),
  snapshots: snap([
    { daysAgo: 30, totalSolved: 100, rating: 1400, contestsAttended: 5 },
    { daysAgo: 1, totalSolved: 160, rating: 1450, contestsAttended: 8 },
  ]),
  contestsKnown: true,
};

const types = (result: ReturnType<typeof evaluateRules>) => result.map((c) => c.type).sort();

describe('alert rules', () => {
  it('raises nothing for a student who is progressing', () => {
    expect(evaluateRules(base)).toEqual([]);
  });

  it('raises nothing at all when the rules are disabled', () => {
    expect(evaluateRules({ ...base, rules: rules({ enabled: false }), hasHandles: false })).toEqual([]);
  });

  it('flags a student with no handles on file', () => {
    const result = evaluateRules({ ...base, hasHandles: false });
    expect(types(result)).toEqual(['NO_PLATFORM_HANDLES']);
    expect(result[0]!.severity).toBe('INFO');
  });

  it('flags a student whose handles have never returned anything', () => {
    const result = evaluateRules({ ...base, availableProfiles: 0, snapshots: [] });
    expect(types(result)).toContain('NO_DATA');
  });

  describe('the stale-data guard', () => {
    it('never blames a student for inactivity we simply did not observe', () => {
      // Solved count is flat, which would normally be NO_PROGRESS — but the
      // last successful fetch is ancient, so we cannot actually tell.
      const result = evaluateRules({
        ...base,
        lastSuccessAt: daysAgo(40),
        snapshots: snap([
          { daysAgo: 60, totalSolved: 100 },
          { daysAgo: 40, totalSolved: 100 },
        ]),
      });
      expect(types(result)).toEqual(['STALE_DATA']);
      expect(result[0]!.type).not.toBe('NO_PROGRESS');
    });

    it('points the finger at the operator, not the student', () => {
      const result = evaluateRules({ ...base, lastSuccessAt: daysAgo(40) });
      expect(result[0]!.severity).toBe('INFO');
      expect(result[0]!.message).toMatch(/Refresh before drawing conclusions/i);
    });

    it('judges activity normally once the data is fresh again', () => {
      const result = evaluateRules({
        ...base,
        lastSuccessAt: daysAgo(1),
        snapshots: snap([
          { daysAgo: 30, totalSolved: 100 },
          { daysAgo: 1, totalSolved: 100 },
        ]),
      });
      expect(types(result)).toContain('NO_PROGRESS');
    });
  });

  describe('no progress', () => {
    it('flags a flat solved count across the window', () => {
      const result = evaluateRules({
        ...base,
        snapshots: snap([
          { daysAgo: 30, totalSolved: 187 },
          { daysAgo: 1, totalSolved: 187 },
        ]),
      });
      const alert = result.find((c) => c.type === 'NO_PROGRESS')!;
      expect(alert.severity).toBe('WARNING');
      // The evidence has to carry the numbers, so a coach can check the claim.
      expect(alert.evidence).toMatchObject({ gained: 0 });
      expect(alert.message).toContain('187');
    });

    it('does not flag a single observation — one point proves nothing', () => {
      const result = evaluateRules({ ...base, snapshots: snap([{ daysAgo: 1, totalSolved: 100 }]) });
      expect(types(result)).not.toContain('NO_PROGRESS');
    });

    it('does not flag when the observations do not span the window yet', () => {
      // Two points, but only three days apart against a 21-day window.
      const result = evaluateRules({
        ...base,
        snapshots: snap([
          { daysAgo: 4, totalSolved: 100 },
          { daysAgo: 1, totalSolved: 100 },
        ]),
      });
      expect(types(result)).not.toContain('NO_PROGRESS');
    });

    it('respects a configured minimum amount of progress', () => {
      const snapshots = snap([
        { daysAgo: 30, totalSolved: 100 },
        { daysAgo: 1, totalSolved: 103 },
      ]);
      expect(types(evaluateRules({ ...base, snapshots }))).not.toContain('NO_PROGRESS');
      expect(types(evaluateRules({ ...base, rules: rules({ minProgressSolved: 5 }), snapshots }))).toContain('NO_PROGRESS');
    });
  });

  describe('rating decline', () => {
    it('flags a drop from the window peak', () => {
      const result = evaluateRules({
        ...base,
        snapshots: snap([
          { daysAgo: 20, totalSolved: 100, rating: 1600 },
          { daysAgo: 10, totalSolved: 130, rating: 1700 },
          { daysAgo: 1, totalSolved: 160, rating: 1560 },
        ]),
      });
      const alert = result.find((c) => c.type === 'RATING_DECLINE')!;
      expect(alert).toBeDefined();
      expect(alert.evidence).toMatchObject({ drop: 140 });
    });

    it('ignores a dip that stays inside the threshold', () => {
      const result = evaluateRules({
        ...base,
        snapshots: snap([
          { daysAgo: 20, totalSolved: 100, rating: 1700 },
          { daysAgo: 1, totalSolved: 160, rating: 1650 },
        ]),
      });
      expect(types(result)).not.toContain('RATING_DECLINE');
    });

    it('measures against the peak inside the window, not an all-time high', () => {
      // A personal best long ago must not read as a decline today.
      const result = evaluateRules({
        ...base,
        snapshots: snap([
          { daysAgo: 300, totalSolved: 50, rating: 2200 },
          { daysAgo: 20, totalSolved: 100, rating: 1500 },
          { daysAgo: 1, totalSolved: 160, rating: 1510 },
        ]),
      });
      expect(types(result)).not.toContain('RATING_DECLINE');
    });
  });

  describe('broken handles', () => {
    it('flags a handle that has never once worked', () => {
      const result = evaluateRules({
        ...base,
        brokenProfiles: [{ platform: 'LEETCODE', status: 'NOT_FOUND', lastSuccessAt: null }],
      });
      const alert = result.find((c) => c.type === 'PROFILE_UNAVAILABLE')!;
      expect(alert.message).toMatch(/LeetCode/);
      expect(alert.message).toMatch(/not found/i);
    });

    it('gives a recently-working handle the benefit of the doubt', () => {
      const result = evaluateRules({
        ...base,
        rules: rules({ brokenProfileDays: 7 }),
        brokenProfiles: [{ platform: 'CODECHEF', status: 'ERROR', lastSuccessAt: daysAgo(2) }],
      });
      expect(types(result)).not.toContain('PROFILE_UNAVAILABLE');
    });
  });

  describe('contest inactivity', () => {
    it('flags a student who has entered no new contest', () => {
      const result = evaluateRules({
        ...base,
        rules: rules({ contestInactivityDays: 30 }),
        snapshots: snap([
          { daysAgo: 40, totalSolved: 100, contestsAttended: 12 },
          { daysAgo: 1, totalSolved: 100, contestsAttended: 12 },
        ]),
      });
      expect(types(result)).toContain('CONTEST_INACTIVE');
    });

    it('stays silent when no platform publishes contest data at all', () => {
      const result = evaluateRules({
        ...base,
        contestsKnown: false,
        rules: rules({ contestInactivityDays: 30 }),
        snapshots: snap([
          { daysAgo: 40, totalSolved: 100, contestsAttended: null },
          { daysAgo: 1, totalSolved: 100, contestsAttended: null },
        ]),
      });
      expect(types(result)).not.toContain('CONTEST_INACTIVE');
    });
  });

  it('honours muted rule types', () => {
    const snapshots = snap([
      { daysAgo: 30, totalSolved: 100 },
      { daysAgo: 1, totalSolved: 100 },
    ]);
    expect(types(evaluateRules({ ...base, snapshots }))).toContain('NO_PROGRESS');
    expect(types(evaluateRules({ ...base, snapshots, rules: rules({ mutedTypes: ['NO_PROGRESS'] }) }))).not.toContain('NO_PROGRESS');
  });

  it('can raise several distinct concerns at once', () => {
    const result = evaluateRules({
      ...base,
      brokenProfiles: [{ platform: 'LEETCODE', status: 'PRIVATE', lastSuccessAt: null }],
      snapshots: snap([
        { daysAgo: 30, totalSolved: 100, rating: 1700, contestsAttended: 4 },
        { daysAgo: 1, totalSolved: 100, rating: 1500, contestsAttended: 4 },
      ]),
    });
    expect(types(result)).toEqual(expect.arrayContaining(['NO_PROGRESS', 'PROFILE_UNAVAILABLE', 'RATING_DECLINE']));
  });
});
