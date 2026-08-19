import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { extractSolved, ratingToDifficulty } from '../src/platforms/codeforces/adapter.js';
import { flattenTagCounts } from '../src/platforms/leetcode/adapter.js';
import { parseCodeChefProfile, parseRatingSeries } from '../src/platforms/codechef/adapter.js';
import { summarizeDomains } from '../src/platforms/hackerrank/adapter.js';
import { getAdapter, resetAdapters } from '../src/platforms/registry.js';
import { ALL_PLATFORMS } from '../src/config/platforms.js';
import { TokenBucket, resetBuckets } from '../src/platforms/rateLimiter.js';
import { backoffDelay } from '../src/platforms/http.js';

// The DB-backed response cache is irrelevant to adapter parsing; stub it out so
// these tests need no database.
vi.mock('../src/platforms/cache.js', () => ({
  readCache: async () => null,
  writeCache: async () => undefined,
  invalidateCache: async () => 0,
  purgeExpiredCache: async () => 0,
}));

describe('Codeforces parsing', () => {
  it('maps problem ratings onto comparable difficulty buckets', () => {
    expect(ratingToDifficulty(800)).toBe('EASY');
    expect(ratingToDifficulty(1200)).toBe('EASY');
    expect(ratingToDifficulty(1201)).toBe('MEDIUM');
    expect(ratingToDifficulty(1900)).toBe('MEDIUM');
    expect(ratingToDifficulty(1901)).toBe('HARD');
    // An unrated problem must stay UNKNOWN rather than defaulting to EASY.
    expect(ratingToDifficulty(undefined)).toBe('UNKNOWN');
  });

  it('counts each solved problem once and keeps the earliest solve date', () => {
    const submissions = [
      { id: 1, creationTimeSeconds: 2000, verdict: 'OK', problem: { contestId: 100, index: 'A', name: 'Watermelon', type: 'PROGRAMMING', rating: 800, tags: ['math'] } },
      { id: 2, creationTimeSeconds: 1000, verdict: 'OK', problem: { contestId: 100, index: 'A', name: 'Watermelon', type: 'PROGRAMMING', rating: 800, tags: ['math'] } },
      { id: 3, creationTimeSeconds: 3000, verdict: 'WRONG_ANSWER', problem: { contestId: 100, index: 'B', name: 'Bit++', type: 'PROGRAMMING', rating: 900, tags: ['implementation'] } },
    ];
    const { problems, topics } = extractSolved(submissions as never);

    expect(problems).toHaveLength(1);
    expect(problems[0]!.solvedAt!.getTime()).toBe(1000 * 1000);
    // A rejected submission is an attempt, never a solve.
    expect(problems.some((p) => p.name === 'Bit++')).toBe(false);
    expect(topics).toEqual([{ topic: 'Math', problemsSolved: 1 }]);
  });
});

describe('LeetCode parsing', () => {
  it('merges the fundamental/intermediate/advanced tag buckets', () => {
    const topics = flattenTagCounts({
      fundamental: [{ tagName: 'Array', tagSlug: 'array', problemsSolved: 80 }],
      intermediate: [{ tagName: 'Dynamic Programming', tagSlug: 'dynamic-programming', problemsSolved: 30 }],
      advanced: [{ tagName: 'Segment Tree', tagSlug: 'segment-tree', problemsSolved: 5 }],
    });
    expect(topics).toEqual([
      { topic: 'Arrays', problemsSolved: 80 },
      { topic: 'Dynamic Programming', problemsSolved: 30 },
      { topic: 'Segment Tree', problemsSolved: 5 },
    ]);
  });

  it('drops zero-count tags and tolerates a missing tag block', () => {
    expect(flattenTagCounts({ fundamental: [{ tagName: 'Array', tagSlug: 'array', problemsSolved: 0 }], intermediate: [], advanced: [] })).toEqual([]);
    expect(flattenTagCounts(null)).toEqual([]);
    expect(flattenTagCounts(undefined)).toEqual([]);
  });

  it('normalizes both profile URL shapes and bare usernames', () => {
    const adapter = getAdapter('LEETCODE', 'live');
    expect(adapter.normalizeUsername('https://leetcode.com/u/alice/')).toBe('alice');
    expect(adapter.normalizeUsername('https://leetcode.com/bob/')).toBe('bob');
    expect(adapter.normalizeUsername('  carol ')).toBe('carol');
    expect(adapter.normalizeUsername('@dave')).toBe('dave');
  });
});

describe('CodeChef parsing', () => {
  const html = `
    <div class="rating-number">1842</div>
    <small>(Highest Rating 1967)</small>
    <span class="rating">4★</span>
    <ul class="rating-ranks"><li><a href="#"><strong>12,345</strong><br/>Global Rank</a></li>
    <li><a href="#"><strong>4,321</strong><br/>Country Rank</a></li></ul>
    <h3>Total Problems Solved: 287</h3>
    <script>var all_rating = [
      {"code":"START100","getyear":"2024","getmonth":"1","getday":"15","reason":null,"penalised_in":null,"rating":"1700","rank":"512","name":"Starters 100"},
      {"code":"START101","getyear":"2024","getmonth":"2","getday":"12","rating":"1842","rank":"318","name":"Starters 101"}
    ];</script>`;

  it('extracts rating, stars, ranks and solved count from the public profile page', () => {
    const parsed = parseCodeChefProfile(html, 'someuser');
    expect(parsed.rating).toBe(1842);
    expect(parsed.maxRating).toBe(1967);
    expect(parsed.stars).toBe('4★');
    expect(parsed.globalRank).toBe(12345);
    expect(parsed.countryRank).toBe(4321);
    expect(parsed.problemsSolved).toBe(287);
  });

  it('derives contest deltas from the inlined rating series', () => {
    const rows = parseRatingSeries(html);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ code: 'START100', rating: 1700, ratingBefore: null, rank: 512 });
    expect(rows[1]).toMatchObject({ code: 'START101', rating: 1842, ratingBefore: 1700, rank: 318 });
    expect(rows[1]!.date!.toISOString().slice(0, 10)).toBe('2024-02-12');
  });

  it('returns nulls rather than guesses when the page layout changes', () => {
    const parsed = parseCodeChefProfile('<html><body>Nothing familiar here</body></html>', 'someuser');
    expect(parsed.rating).toBeNull();
    expect(parsed.problemsSolved).toBeNull();
    expect(parsed.contests).toEqual([]);
  });

  it('survives malformed embedded JSON', () => {
    expect(parseRatingSeries('<script>var all_rating = [{oops];</script>')).toEqual([]);
  });
});

describe('HackerRank parsing', () => {
  it('summarizes badges into domain progress and preserves missing values as null', () => {
    const domains = summarizeDomains([
      { badge_name: 'Problem Solving', stars: 5, solved: 120, total_challenges: 563, score: 2100 },
      { badge_name: 'SQL', stars: 3, solved: 40, total_challenges: 58 },
      { badge_name: undefined, stars: 1 },
    ]);
    expect(domains).toHaveLength(2);
    expect(domains[0]).toEqual({ domain: 'Problem Solving', stars: 5, solved: 120, totalChallenges: 563, score: 2100 });
    // No score published -> null, not 0.
    expect(domains[1]!.score).toBeNull();
  });
});

describe('adapter contract', () => {
  beforeEach(() => {
    resetAdapters();
    resetBuckets();
  });
  afterEach(() => resetAdapters());

  it('every platform exposes the full shared interface', () => {
    for (const platform of ALL_PLATFORMS) {
      const adapter = getAdapter(platform, 'live');
      for (const method of ['getProfile', 'getSolvedProblems', 'getProblemTopics', 'getContests', 'getRatings', 'getRanking', 'getRecentActivity', 'fetchAll', 'validateUsername', 'normalizeUsername', 'buildProfileUrl'] as const) {
        expect(typeof adapter[method], `${platform}.${method}`).toBe('function');
      }
    }
  });

  it('rejects malformed handles before spending a request', () => {
    const cf = getAdapter('CODEFORCES', 'live');
    expect(cf.validateUsername('ab').valid).toBe(false);
    expect(cf.validateUsername('has spaces').valid).toBe(false);
    expect(cf.validateUsername('tourist').valid).toBe(true);
    expect(getAdapter('LEETCODE', 'live').validateUsername('').valid).toBe(false);
  });

  it('reports a failure status per scenario instead of inventing numbers', async () => {
    const cases = [
      ['someone_notfound', 'NOT_FOUND'],
      ['someone_private', 'PRIVATE'],
      ['someone_ratelimited', 'RATE_LIMITED'],
      ['someone_unavailable', 'UNAVAILABLE'],
      ['someone_error', 'ERROR'],
    ] as const;

    for (const [username, expected] of cases) {
      const snapshot = await getAdapter('LEETCODE', 'mock').fetchAll(username);
      expect(snapshot.status, username).toBe(expected);
      expect(snapshot.profile.data).toBeUndefined();
      expect(snapshot.statusMessage).toBeTruthy();
    }
  });

  it('is deterministic, so the same handle always yields the same numbers', async () => {
    const first = await getAdapter('CODEFORCES', 'mock').fetchAll('stable_user');
    const second = await getAdapter('CODEFORCES', 'mock').fetchAll('stable_user');
    expect(second.profile.data!.totalSolved).toBe(first.profile.data!.totalSolved);
    expect(second.profile.data!.rating).toBe(first.profile.data!.rating);
  });

  it('mirrors each platform\'s real data gaps', async () => {
    const hackerrank = await getAdapter('HACKERRANK', 'mock').fetchAll('some_user');
    // HackerRank publishes no rating, ranking or contest history.
    expect(hackerrank.profile.data!.rating).toBeNull();
    expect(hackerrank.contests.status).toBe('UNAVAILABLE');
    expect(hackerrank.ratings.status).toBe('UNAVAILABLE');
    expect(hackerrank.ranking.status).toBe('UNAVAILABLE');

    // CodeChef publishes no topic breakdown.
    const codechef = await getAdapter('CODECHEF', 'mock').fetchAll('some_user');
    expect(codechef.topics.status).toBe('UNAVAILABLE');
    expect(codechef.profile.data!.easySolved).toBeNull();

    // LeetCode publishes counts but never a per-problem list.
    const leetcode = await getAdapter('LEETCODE', 'mock').fetchAll('some_user');
    expect(leetcode.problems.status).toBe('UNAVAILABLE');
    expect(leetcode.topics.status).toBe('AVAILABLE');
  });
});

describe('outbound request safety', () => {
  beforeEach(() => resetAdapters());

  it('never lets a crafted handle move the request off the platform host', () => {
    const attacks = [
      'https://evil.example.com/pwned',
      'http://169.254.169.254/latest/meta-data/',
      '../../../etc/passwd',
      'user/../../admin',
      'user?x=1',
      'user#frag',
      'javascript:alert(1)',
    ];
    const expectedHost: Record<string, string> = {
      LEETCODE: 'leetcode.com',
      CODECHEF: 'www.codechef.com',
      HACKERRANK: 'www.hackerrank.com',
      CODEFORCES: 'codeforces.com',
    };

    for (const platform of ALL_PLATFORMS) {
      const adapter = getAdapter(platform, 'live');
      for (const raw of attacks) {
        const username = adapter.normalizeUsername(raw);
        if (!adapter.validateUsername(username).valid) continue;
        // Anything that survives validation still targets the platform itself.
        expect(new URL(adapter.buildProfileUrl(username)).host, `${platform} <- ${raw}`).toBe(expectedHost[platform]);
      }
    }
  });
});

describe('rate limiting and backoff', () => {
  beforeEach(() => resetBuckets());

  it('serializes acquisitions so concurrent callers cannot overdraw', async () => {
    const bucket = new TokenBucket(600, 2);
    const started = Date.now();
    await Promise.all([bucket.acquire(), bucket.acquire(), bucket.acquire()]);
    // Two tokens are free; the third has to wait for a refill.
    expect(Date.now() - started).toBeGreaterThan(20);
  });

  it('blocks the whole platform while a penalty is in effect', async () => {
    const bucket = new TokenBucket(600, 5);
    bucket.penalize(120);
    expect(bucket.penaltyRemainingMs).toBeGreaterThan(0);
    const started = Date.now();
    await bucket.acquire();
    expect(Date.now() - started).toBeGreaterThanOrEqual(100);
  });

  it('backs off exponentially and stays under the cap', () => {
    for (let attempt = 0; attempt < 12; attempt++) {
      const delay = backoffDelay(attempt, 1_000, 30_000);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(30_000);
    }
    // Full jitter means the *ceiling* grows, so compare maxima over samples.
    const early = Math.max(...Array.from({ length: 200 }, () => backoffDelay(0, 1_000, 30_000)));
    const late = Math.max(...Array.from({ length: 200 }, () => backoffDelay(4, 1_000, 30_000)));
    expect(late).toBeGreaterThan(early);
  });
});
