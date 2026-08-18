/**
 * Topic normalization.
 *
 * Each platform names the same concept differently ("dp" / "dynamic-programming"
 * / "Dynamic Programming"). The unified topic dashboard only works if they all
 * collapse onto one canonical name, so every adapter pushes its raw tags
 * through `normalizeTopic`.
 *
 * Unknown tags are NOT dropped — they are title-cased and kept, so a new tag on
 * a platform shows up in the dashboard instead of silently vanishing.
 */

export const CANONICAL_TOPICS = [
  'Arrays',
  'Strings',
  'Hash Table',
  'Dynamic Programming',
  'Graphs',
  'Trees',
  'Binary Search Tree',
  'Binary Search',
  'Greedy',
  'Backtracking',
  'Linked List',
  'Stack',
  'Queue',
  'Heap',
  'Math',
  'Number Theory',
  'Combinatorics',
  'Geometry',
  'Sorting',
  'Two Pointers',
  'Sliding Window',
  'Bit Manipulation',
  'Recursion',
  'Divide and Conquer',
  'Union Find',
  'Trie',
  'Segment Tree',
  'Simulation',
  'Matrix',
  'Prefix Sum',
  'Depth-First Search',
  'Breadth-First Search',
  'Shortest Path',
  'Topological Sort',
  'Minimum Spanning Tree',
  'Game Theory',
  'Probability',
  'Data Structures',
  'Algorithms',
  'Implementation',
  'Constructive Algorithms',
  'Brute Force',
  'String Matching',
  'Network Flow',
  'Databases',
  'Regex',
  'Concurrency',
  'Functional Programming',
  'Artificial Intelligence',
  'Security',
  'Shell',
  'Python',
  'Java',
  'C++',
] as const;

export type CanonicalTopic = (typeof CANONICAL_TOPICS)[number];

const ALIASES: Record<string, CanonicalTopic> = {
  // Arrays
  array: 'Arrays', arrays: 'Arrays', 'ordered-set': 'Arrays',
  // Strings
  string: 'Strings', strings: 'Strings', 'string-suffix-structures': 'String Matching',
  'string-matching': 'String Matching', 'rolling-hash': 'String Matching', hashing: 'Hash Table',
  'hash-table': 'Hash Table', 'hash-function': 'Hash Table',
  // DP
  dp: 'Dynamic Programming', 'dynamic-programming': 'Dynamic Programming', memoization: 'Dynamic Programming',
  // Graphs / traversal
  graph: 'Graphs', graphs: 'Graphs', 'graph-matchings': 'Graphs', dsu: 'Union Find', 'union-find': 'Union Find',
  'disjoint-set': 'Union Find', 'dfs-and-similar': 'Depth-First Search', 'depth-first-search': 'Depth-First Search',
  'breadth-first-search': 'Breadth-First Search', bfs: 'Breadth-First Search', dfs: 'Depth-First Search',
  'shortest-paths': 'Shortest Path', 'shortest-path': 'Shortest Path', 'topological-sort': 'Topological Sort',
  'minimum-spanning-tree': 'Minimum Spanning Tree', flows: 'Network Flow', 'network-flow': 'Network Flow',
  'strongly-connected-component': 'Graphs', 'biconnected-component': 'Graphs', 'eulerian-circuit': 'Graphs',
  '2-sat': 'Graphs',
  // Trees
  tree: 'Trees', trees: 'Trees', 'binary-tree': 'Trees', 'binary-search-tree': 'Binary Search Tree',
  'segment-tree': 'Segment Tree', 'binary-indexed-tree': 'Segment Tree', trie: 'Trie',
  // Search / sort
  'binary-search': 'Binary Search', 'ternary-search': 'Binary Search', sortings: 'Sorting', sorting: 'Sorting',
  'merge-sort': 'Sorting', 'counting-sort': 'Sorting', 'radix-sort': 'Sorting', 'bucket-sort': 'Sorting',
  quickselect: 'Sorting', 'two-pointers': 'Two Pointers', 'sliding-window': 'Sliding Window',
  'meet-in-the-middle': 'Divide and Conquer', 'divide-and-conquer': 'Divide and Conquer',
  // Greedy / brute force
  greedy: 'Greedy', 'brute-force': 'Brute Force', enumeration: 'Brute Force', backtracking: 'Backtracking',
  'constructive-algorithms': 'Constructive Algorithms', implementation: 'Implementation', simulation: 'Simulation',
  // Linear structures
  'linked-list': 'Linked List', 'doubly-linked-list': 'Linked List', stack: 'Stack', 'monotonic-stack': 'Stack',
  queue: 'Queue', 'monotonic-queue': 'Queue', 'heap-priority-queue': 'Heap', heap: 'Heap',
  'priority-queue': 'Heap', 'data-structures': 'Data Structures', 'data-stream': 'Data Structures',
  // Math
  math: 'Math', mathematics: 'Math', 'number-theory': 'Number Theory', combinatorics: 'Combinatorics',
  geometry: 'Geometry', matrices: 'Matrix', matrix: 'Matrix', 'prefix-sum': 'Prefix Sum',
  probabilities: 'Probability', 'probability-and-statistics': 'Probability', fft: 'Math',
  'chinese-remainder-theorem': 'Number Theory', 'expression-parsing': 'Implementation', counting: 'Combinatorics',
  // Bits / misc
  bitmasks: 'Bit Manipulation', bitmask: 'Bit Manipulation', 'bit-manipulation': 'Bit Manipulation',
  recursion: 'Recursion', games: 'Game Theory', 'game-theory': 'Game Theory', algorithms: 'Algorithms',
  // Non-algorithmic domains (mostly HackerRank)
  sql: 'Databases', databases: 'Databases', database: 'Databases', regex: 'Regex', concurrency: 'Concurrency',
  'functional-programming': 'Functional Programming', ai: 'Artificial Intelligence',
  'artificial-intelligence': 'Artificial Intelligence', security: 'Security', shell: 'Shell', bash: 'Shell',
  python: 'Python', java: 'Java', cpp: 'C++', 'c++': 'C++', 'c-plus-plus': 'C++',
};

export function topicSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9+-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
}

function titleCase(raw: string): string {
  return raw
    .trim()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w[0]!.toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}

export function normalizeTopic(raw: string): string {
  if (!raw?.trim()) return 'Unknown';
  const slug = topicSlug(raw);
  return ALIASES[slug] ?? titleCase(raw);
}

/** Collapse a list of raw tags into canonical names, de-duplicated. */
export function normalizeTopics(raws: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const raw of raws) {
    const t = normalizeTopic(raw);
    if (t !== 'Unknown') seen.add(t);
  }
  return [...seen];
}

/** Merge per-platform topic counts into one unified tally. */
export function mergeTopicCounts(
  entries: readonly { topic: string; problemsSolved: number }[],
): { topic: string; problemsSolved: number }[] {
  const totals = new Map<string, number>();
  for (const { topic, problemsSolved } of entries) {
    const canonical = normalizeTopic(topic);
    totals.set(canonical, (totals.get(canonical) ?? 0) + problemsSolved);
  }
  return [...totals.entries()]
    .map(([topic, problemsSolved]) => ({ topic, problemsSolved }))
    .sort((a, b) => b.problemsSolved - a.problemsSolved);
}
