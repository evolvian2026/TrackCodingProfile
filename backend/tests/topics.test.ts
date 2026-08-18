import { describe, expect, it } from 'vitest';
import { mergeTopicCounts, normalizeTopic, normalizeTopics, topicSlug } from '../src/platforms/topics.js';

describe('topic normalization', () => {
  it('collapses the same concept across platform naming conventions', () => {
    // Codeforces "dp", LeetCode "dynamic-programming", plain prose.
    expect(normalizeTopic('dp')).toBe('Dynamic Programming');
    expect(normalizeTopic('dynamic-programming')).toBe('Dynamic Programming');
    expect(normalizeTopic('Dynamic Programming')).toBe('Dynamic Programming');
    expect(normalizeTopic('DYNAMIC_PROGRAMMING')).toBe('Dynamic Programming');
  });

  it('maps platform-specific aliases onto canonical names', () => {
    expect(normalizeTopic('dfs and similar')).toBe('Depth-First Search');
    expect(normalizeTopic('heap-priority-queue')).toBe('Heap');
    expect(normalizeTopic('dsu')).toBe('Union Find');
    expect(normalizeTopic('sortings')).toBe('Sorting');
    expect(normalizeTopic('SQL')).toBe('Databases');
    expect(normalizeTopic('bitmasks')).toBe('Bit Manipulation');
  });

  it('keeps unknown tags instead of silently dropping them', () => {
    // A new tag on a platform must still surface in the dashboard.
    expect(normalizeTopic('quantum-annealing')).toBe('Quantum Annealing');
  });

  it('treats empty input as Unknown and filters it out of lists', () => {
    expect(normalizeTopic('')).toBe('Unknown');
    expect(normalizeTopics(['', '  ', 'array'])).toEqual(['Arrays']);
  });

  it('de-duplicates aliases that collapse onto one canonical topic', () => {
    expect(normalizeTopics(['array', 'Arrays', 'ordered-set'])).toEqual(['Arrays']);
  });

  it('sums counts across platforms and sorts by volume', () => {
    const merged = mergeTopicCounts([
      { topic: 'dp', problemsSolved: 10 },
      { topic: 'dynamic-programming', problemsSolved: 5 },
      { topic: 'array', problemsSolved: 40 },
    ]);
    expect(merged).toEqual([
      { topic: 'Arrays', problemsSolved: 40 },
      { topic: 'Dynamic Programming', problemsSolved: 15 },
    ]);
  });

  it('produces url-safe slugs', () => {
    expect(topicSlug('Depth-First Search')).toBe('depth-first-search');
    expect(topicSlug('C++')).toBe('c++');
  });
});
