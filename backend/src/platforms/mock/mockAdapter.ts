import type { Difficulty, Platform } from '@prisma/client';
import { BaseAdapter, type SnapshotParts } from '../base.js';
import { platformMeta } from '../../config/platforms.js';
import { normalizeTopic } from '../topics.js';
import { PlatformFetchError, type PlatformAdapter, type NormalizedActivity, type NormalizedContest, type NormalizedProblem, type NormalizedProfile, type NormalizedRanking, type NormalizedRatingPoint, type NormalizedTopic } from '../types.js';
import { LIVE_ADAPTER_FACTORIES } from '../liveFactories.js';
import { SeededRandom } from './random.js';
import { TIER_PROFILE, resolveScenario } from './scenarios.js';

const TOPIC_POOL = [
  'Arrays', 'Strings', 'Dynamic Programming', 'Graphs', 'Trees', 'Binary Search', 'Greedy',
  'Backtracking', 'Linked List', 'Stack', 'Queue', 'Math', 'Sorting', 'Hash Table',
  'Two Pointers', 'Bit Manipulation', 'Heap', 'Recursion', 'Number Theory', 'Matrix',
  'Sliding Window', 'Union Find', 'Trie', 'Geometry', 'Game Theory', 'Prefix Sum',
  'Depth-First Search', 'Breadth-First Search', 'Shortest Path', 'Topological Sort',
  'Segment Tree', 'Combinatorics', 'Divide and Conquer', 'Simulation', 'Implementation',
  'Constructive Algorithms', 'Brute Force', 'String Matching', 'Probability', 'Data Structures',
];

/** No single platform covers everything, so each is capped well below the pool. */
const MAX_TOPICS_PER_PLATFORM = 16;

const PROBLEM_WORDS = [
  'Two Sum', 'Longest Substring', 'Median of Arrays', 'Valid Parentheses', 'Merge Intervals',
  'Word Ladder', 'Coin Change', 'Course Schedule', 'LRU Cache', 'Rotate Image', 'Jump Game',
  'Edit Distance', 'Word Break', 'Number of Islands', 'Path Sum', 'Subarray Sum', 'Gas Station',
  'Trapping Rain Water', 'Spiral Matrix', 'Binary Tree Zigzag', 'Minimum Window Substring',
];

const HR_DOMAINS = ['Problem Solving', 'Algorithms', 'Data Structures', 'Mathematics', 'SQL', 'Python', 'Java', 'C++', 'Artificial Intelligence'];

/**
 * Mock adapter used when `DATA_SOURCE=mock`. It mirrors the *shape and the
 * gaps* of each real platform (LeetCode never lists individual problems,
 * HackerRank never exposes contests, …) so the UI is developed against
 * realistic data availability rather than an idealized fixture.
 */
export class MockAdapter extends BaseAdapter {
  readonly platform: Platform;
  readonly label: string;
  /**
   * The real adapter, used only for its handle syntax rules. Delegating means a
   * handle accepted in mock mode is exactly a handle accepted in live mode —
   * otherwise an import validated in development would fail in production.
   */
  private readonly rules: PlatformAdapter;

  constructor(platform: Platform) {
    super();
    this.platform = platform;
    this.label = `${platformMeta(platform).label} (mock)`;
    this.rules = LIVE_ADAPTER_FACTORIES[platform]();
  }

  buildProfileUrl(username: string): string {
    return platformMeta(this.platform).profileUrl(username);
  }

  override normalizeUsername(input: string): string {
    return this.rules.normalizeUsername(input);
  }

  override validateUsername(username: string): { valid: boolean; reason?: string } {
    return this.rules.validateUsername(username);
  }

  protected async load(username: string): Promise<SnapshotParts> {
    // A tiny delay keeps progress bars and concurrency behaviour realistic.
    await new Promise((r) => setTimeout(r, 15 + Math.random() * 60));

    const scenario = resolveScenario(username);
    if (scenario.status !== 'AVAILABLE') {
      throw new PlatformFetchError(scenario.status, scenario.message ?? 'Mock failure scenario', scenario.status === 'RATE_LIMITED');
    }

    const rng = new SeededRandom(`${this.platform}:${username.toLowerCase()}`);
    const tier = TIER_PROFILE[scenario.tier];
    const meta = platformMeta(this.platform);

    const totalSolved = rng.int(tier.solvedRange[0], tier.solvedRange[1]);
    const rating = rng.int(tier.ratingRange[0], tier.ratingRange[1]);
    const contestCount = rng.int(tier.contestRange[0], tier.contestRange[1]);

    const difficulty = splitDifficulty(totalSolved, rng);
    const topics = buildTopics(totalSolved, rng);
    const contests = buildContests(this.platform, contestCount, rating, rng);
    const ratings: NormalizedRatingPoint[] = contests
      .filter((c) => c.startTime && c.ratingAfter != null)
      .map((c) => ({ rating: c.ratingAfter!, recordedAt: c.startTime!, contestName: c.name }));

    // HackerRank publishes no rating, no ranking and no contest history — the
    // mock has to reproduce those gaps or the UI gets developed against data
    // that will never exist in production.
    const hasRating = this.platform !== 'HACKERRANK';

    const profile: NormalizedProfile = {
      username,
      profileUrl: this.buildProfileUrl(username),
      displayName: null,
      country: rng.pick(['India', 'India', 'India', 'United States', null]),
      avatarUrl: null,
      rating: hasRating ? rating : null,
      maxRating: hasRating ? rating + rng.int(0, 180) : null,
      globalRank: hasRating ? rng.int(1_000, 900_000) : null,
      countryRank: this.platform === 'CODECHEF' ? rng.int(100, 200_000) : null,
      stars: this.platform === 'CODECHEF' ? `${Math.min(7, Math.max(1, Math.floor((rating - 1000) / 200) + 1))}★` : null,
      rankTitle: this.platform === 'CODEFORCES' ? codeforcesRank(rating) : null,
      maxRankTitle: this.platform === 'CODEFORCES' ? codeforcesRank(rating + 100) : null,
      reputation: this.platform === 'LEETCODE' ? rng.int(0, 500) : null,
      contribution: this.platform === 'CODEFORCES' ? rng.int(-5, 60) : null,
      friendCount: this.platform === 'CODEFORCES' ? rng.int(0, 400) : null,
      totalSolved: this.platform === 'HACKERRANK' ? Math.round(totalSolved / 3) : totalSolved,
      easySolved: meta.hasDifficultyBreakdown ? difficulty.easy : null,
      mediumSolved: meta.hasDifficultyBreakdown ? difficulty.medium : null,
      hardSolved: meta.hasDifficultyBreakdown ? difficulty.hard : null,
      problemsAttempted: this.platform === 'CODEFORCES' ? totalSolved + rng.int(10, 120) : null,
      totalSubmissions: this.platform === 'HACKERRANK' ? null : totalSolved * rng.int(2, 4),
      acceptedSubmissions: this.platform === 'HACKERRANK' ? null : totalSolved + rng.int(0, 40),
      contestsAttended: meta.hasContests ? contestCount : null,
      contestRating: meta.hasContests ? rating : null,
      contestGlobalRanking: meta.hasContests ? rng.int(500, 400_000) : null,
      contestTopPercentage: meta.hasContests ? Number((rng.next() * 60 + 1).toFixed(2)) : null,
      problemSolvingScore: this.platform === 'HACKERRANK' ? rng.int(500, 9_000) : null,
      badges: this.platform === 'HACKERRANK' ? buildHackerRankBadges(rng) : undefined,
      certificates:
        this.platform === 'HACKERRANK'
          ? ['Problem Solving (Basic)', 'Python (Basic)', 'SQL (Intermediate)'].slice(0, rng.int(0, 3))
          : undefined,
      domains: this.platform === 'HACKERRANK' ? buildHackerRankBadges(rng) : undefined,
      raw: { mock: true, tier: scenario.tier },
    };

    const problems = this.platform === 'CODEFORCES' ? buildProblems(totalSolved, rng) : null;

    return {
      profile: this.ok(profile),
      problems: problems ? this.ok(problems) : this.notPublic<NormalizedProblem[]>('a per-problem solved list'),
      topics: meta.hasTopics ? this.ok(topics) : this.notPublic<NormalizedTopic[]>('topic-wise breakdowns'),
      contests: meta.hasContests && contests.length > 0 ? this.ok(contests) : this.notPublic<NormalizedContest[]>('contest results'),
      ratings: meta.hasContests && ratings.length > 0 ? this.ok(ratings) : this.notPublic<NormalizedRatingPoint[]>('a rating history'),
      ranking: hasRating
        ? this.ok({
            globalRank: profile.globalRank ?? null,
            countryRank: profile.countryRank ?? null,
            rankTitle: profile.rankTitle ?? profile.stars ?? null,
            topPercentage: profile.contestTopPercentage ?? null,
          })
        : this.notPublic<NormalizedRanking>('global or country ranking'),
      recentActivity:
        this.platform === 'HACKERRANK' || this.platform === 'CODECHEF'
          ? this.notPublic<NormalizedActivity[]>('a recent-activity feed')
          : this.ok(buildRecentActivity(rng)),
    };
  }
}

function splitDifficulty(total: number, rng: SeededRandom) {
  const easyShare = 0.35 + rng.next() * 0.2;
  const hardShare = 0.08 + rng.next() * 0.14;
  const easy = Math.round(total * easyShare);
  const hard = Math.round(total * hardShare);
  return { easy, medium: Math.max(0, total - easy - hard), hard };
}

function buildTopics(total: number, rng: SeededRandom): NormalizedTopic[] {
  const count = Math.min(MAX_TOPICS_PER_PLATFORM, Math.max(3, Math.round(total / 22) + rng.int(2, 6)));
  const chosen = [...TOPIC_POOL].sort(() => rng.next() - 0.5).slice(0, count);
  let remaining = total;
  const topics: NormalizedTopic[] = [];
  for (let i = 0; i < chosen.length; i++) {
    const isLast = i === chosen.length - 1;
    const share = isLast ? remaining : Math.max(1, Math.round((remaining / (chosen.length - i)) * (0.5 + rng.next())));
    const solved = Math.min(remaining, share);
    remaining -= solved;
    if (solved > 0) topics.push({ topic: normalizeTopic(chosen[i]!), problemsSolved: solved });
    if (remaining <= 0) break;
  }
  return topics.sort((a, b) => b.problemsSolved - a.problemsSolved);
}

function buildProblems(total: number, rng: SeededRandom): NormalizedProblem[] {
  const count = Math.min(total, 400);
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => {
    const rating = rng.int(800, 2600);
    const difficulty: Difficulty = rating <= 1200 ? 'EASY' : rating <= 1900 ? 'MEDIUM' : 'HARD';
    return {
      externalId: `${rng.int(1000, 1900)}-${String.fromCharCode(65 + (i % 6))}`,
      name: `${rng.pick(PROBLEM_WORDS)} ${i + 1}`,
      url: null,
      difficulty,
      topics: [normalizeTopic(rng.pick(TOPIC_POOL)), normalizeTopic(rng.pick(TOPIC_POOL))].filter(
        (v, idx, arr) => arr.indexOf(v) === idx,
      ),
      points: rating,
      solvedAt: new Date(now - rng.int(0, 720) * 86_400_000),
    };
  });
}

function buildContests(platform: Platform, count: number, finalRating: number, rng: SeededRandom): NormalizedContest[] {
  if (count <= 0) return [];
  const contests: NormalizedContest[] = [];
  const now = Date.now();
  // Walk backwards from the current rating so the series ends where it should.
  let rating = finalRating;
  for (let i = 0; i < count; i++) {
    const change = rng.int(-60, 75);
    const before = rating - change;
    contests.push({
      externalId: `${platform.toLowerCase()}-round-${1000 + i}`,
      name: `${platformMeta(platform).label} Round ${1000 + count - i}`,
      startTime: new Date(now - i * 14 * 86_400_000 - rng.int(0, 3) * 86_400_000),
      url: null,
      rank: rng.int(50, 25_000),
      ratingBefore: before,
      ratingAfter: rating,
      ratingChange: change,
      problemsSolved: rng.int(0, 6),
    });
    rating = before;
  }
  return contests.reverse();
}

function buildHackerRankBadges(rng: SeededRandom) {
  const count = rng.int(2, 6);
  return [...HR_DOMAINS]
    .sort(() => rng.next() - 0.5)
    .slice(0, count)
    .map((domain) => ({
      domain,
      stars: rng.int(1, 5),
      solved: rng.int(5, 180),
      totalChallenges: rng.int(200, 600),
      score: rng.int(100, 2_500),
    }));
}

function buildRecentActivity(rng: SeededRandom): NormalizedActivity[] {
  const now = Date.now();
  return Array.from({ length: rng.int(4, 15) }, (_, i) => ({
    title: `${rng.pick(PROBLEM_WORDS)}`,
    url: null,
    difficulty: rng.pick(['EASY', 'MEDIUM', 'HARD'] as Difficulty[]),
    topics: [normalizeTopic(rng.pick(TOPIC_POOL))],
    solvedAt: new Date(now - (i * 86_400_000 + rng.int(0, 20) * 3_600_000)),
  }));
}

function codeforcesRank(rating: number): string {
  if (rating >= 2400) return 'international master';
  if (rating >= 2100) return 'master';
  if (rating >= 1900) return 'candidate master';
  if (rating >= 1600) return 'expert';
  if (rating >= 1400) return 'specialist';
  if (rating >= 1200) return 'pupil';
  return 'newbie';
}
