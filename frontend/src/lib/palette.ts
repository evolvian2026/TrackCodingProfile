import type { Platform } from '../types/api';

/**
 * Chart palettes.
 *
 * These are NOT the platforms' marketing colours. Those fail the accessibility
 * gates as a chart palette — LeetCode's orange and HackerRank's green are far
 * too light against a white surface, and CodeChef's brown reads as gray. Each
 * hue below was re-stepped and machine-validated (lightness band, chroma floor,
 * colour-blind separation, contrast) for both themes, on the *adjacent* pair
 * list — which is why platform data is drawn as bars and lines and never as a
 * pie: in an all-pairs form the violet and blue steps converge under
 * protanopia. Every platform chart also carries a legend and direct labels, so
 * identity is never colour alone.
 *
 * Administrators can override these from Settings; the API serves the current
 * values and this file is only the fallback.
 */
export const PLATFORM_PALETTE: Record<Platform, { light: string; dark: string }> = {
  LEETCODE: { light: '#EB6834', dark: '#D95926' },
  CODECHEF: { light: '#4A3AA7', dark: '#9085E9' },
  HACKERRANK: { light: '#1BAF7A', dark: '#199E70' },
  CODEFORCES: { light: '#2A78D6', dark: '#3987E5' },
};

/**
 * Difficulty is a *status* encoding, not a categorical one — green/amber/red is
 * the convention every one of these platforms uses, so it reads instantly. Red
 * and green cannot be separated under deuteranopia, so difficulty is never
 * shown as colour alone: the category name is always on the axis, in the legend
 * and in the tooltip.
 *
 * "Unclassified" is deliberately neutral gray: it means the platform published
 * a solved total but no difficulty split.
 */
export const DIFFICULTY_PALETTE: Record<string, { light: string; dark: string }> = {
  EASY: { light: '#15803D', dark: '#22A35A' },
  MEDIUM: { light: '#B45309', dark: '#C98500' },
  HARD: { light: '#B91C1C', dark: '#E05252' },
  UNKNOWN: { light: '#64748B', dark: '#94A3B8' },
  UNCLASSIFIED: { light: '#64748B', dark: '#94A3B8' },
};

/** Single-hue sequential ramp (light -> dark) for magnitude, e.g. the heatmap. */
export const SEQUENTIAL_BLUE = [
  '#CDE2FB', '#B7D3F6', '#9EC5F4', '#86B6EF', '#6DA7EC',
  '#5598E7', '#3987E5', '#2A78D6', '#256ABF', '#1C5CAB',
] as const;

export const SEQUENTIAL_BLUE_DARK = [
  '#0D366B', '#104281', '#184F95', '#1C5CAB', '#256ABF',
  '#2A78D6', '#3987E5', '#5598E7', '#6DA7EC', '#86B6EF',
] as const;

/** Generic single-series accent, matching the sequential hue. */
export const ACCENT = { light: '#2A78D6', dark: '#3987E5' };

export type ThemeMode = 'light' | 'dark';

export function platformColor(
  platform: Platform,
  mode: ThemeMode,
  overrides?: Partial<Record<Platform, { light: string; dark: string }>>,
): string {
  const entry = overrides?.[platform] ?? PLATFORM_PALETTE[platform];
  return entry?.[mode] ?? PLATFORM_PALETTE[platform][mode];
}

export function difficultyColor(key: string, mode: ThemeMode): string {
  return (DIFFICULTY_PALETTE[key.toUpperCase()] ?? DIFFICULTY_PALETTE.UNKNOWN!)[mode];
}

/** Maps a 0..1 magnitude onto the sequential ramp. */
export function sequentialColor(fraction: number, mode: ThemeMode): string {
  const ramp = mode === 'dark' ? SEQUENTIAL_BLUE_DARK : SEQUENTIAL_BLUE;
  const clamped = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  return ramp[Math.min(ramp.length - 1, Math.round(clamped * (ramp.length - 1)))]!;
}
