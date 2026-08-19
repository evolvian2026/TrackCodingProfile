import type { DataStatus, Platform, SkillLevel } from '../types/api';

/**
 * The single place that decides how an absent value is rendered.
 *
 * A platform that never published a number must never be shown as 0 — the two
 * mean different things and the whole product depends on keeping them apart.
 */
export const NOT_AVAILABLE = 'N/A';

export function num(value: number | null | undefined, options: { decimals?: number } = {}): string {
  if (value === null || value === undefined || Number.isNaN(value)) return NOT_AVAILABLE;
  return value.toLocaleString('en-US', {
    minimumFractionDigits: options.decimals ?? 0,
    maximumFractionDigits: options.decimals ?? 0,
  });
}

export function decimal(value: number | null | undefined, places = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return NOT_AVAILABLE;
  return value.toFixed(places);
}

export function percent(value: number | null | undefined, places = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return NOT_AVAILABLE;
  return `${value.toFixed(places)}%`;
}

export function compact(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return NOT_AVAILABLE;
  if (Math.abs(value) < 1000) return String(value);
  return value.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 });
}

export function ordinalRank(value: number | null | undefined): string {
  if (value === null || value === undefined) return NOT_AVAILABLE;
  return `#${value.toLocaleString('en-US')}`;
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return NOT_AVAILABLE;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return NOT_AVAILABLE;
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return NOT_AVAILABLE;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return NOT_AVAILABLE;
  return `${formatDate(date)}, ${date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

export function relativeTime(value: string | Date | null | undefined): string {
  if (!value) return 'Never';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Never';

  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(date);
}

export function duration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return NOT_AVAILABLE;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

// -- status presentation -----------------------------------------------------

export interface StatusPresentation {
  label: string;
  /** Plain-language explanation shown on hover and in empty states. */
  hint: string;
  tone: 'positive' | 'neutral' | 'caution' | 'negative' | 'info';
}

export const STATUS_PRESENTATION: Record<DataStatus, StatusPresentation> = {
  AVAILABLE: { label: 'Available', hint: 'Data was retrieved successfully from this platform.', tone: 'positive' },
  PENDING: { label: 'Not fetched', hint: 'This profile has not been fetched yet.', tone: 'neutral' },
  NOT_FOUND: { label: 'Not found', hint: 'No profile exists on this platform for the stored handle.', tone: 'negative' },
  PRIVATE: { label: 'Private', hint: 'The profile exists but its statistics are not publicly visible.', tone: 'caution' },
  UNAVAILABLE: { label: 'Unavailable', hint: 'The platform does not publish this data, or was temporarily unreachable.', tone: 'caution' },
  ERROR: { label: 'Error', hint: 'The platform returned an unexpected response.', tone: 'negative' },
  RATE_LIMITED: { label: 'Rate limited', hint: 'The platform throttled us. This profile will be retried.', tone: 'info' },
};

export const STATUS_TONE_CLASS: Record<StatusPresentation['tone'], string> = {
  positive: 'bg-positive/10 text-positive',
  neutral: 'bg-ink-subtle/15 text-ink-muted',
  caution: 'bg-caution/10 text-caution',
  negative: 'bg-negative/10 text-negative',
  info: 'bg-brand/10 text-brand',
};

export const SKILL_LEVEL_PRESENTATION: Record<SkillLevel, { label: string; tone: string; weight: number }> = {
  NONE: { label: 'None', tone: 'bg-ink-subtle/15 text-ink-muted', weight: 0 },
  BEGINNER: { label: 'Beginner', tone: 'bg-brand/10 text-brand', weight: 1 },
  INTERMEDIATE: { label: 'Intermediate', tone: 'bg-caution/10 text-caution', weight: 2 },
  ADVANCED: { label: 'Advanced', tone: 'bg-positive/10 text-positive', weight: 3 },
  EXPERT: { label: 'Expert', tone: 'bg-positive/20 text-positive', weight: 4 },
};

export const DIFFICULTY_COLORS: Record<string, string> = {
  EASY: '#16A34A',
  MEDIUM: '#D97706',
  HARD: '#DC2626',
  UNKNOWN: '#94A3B8',
  UNCLASSIFIED: '#94A3B8',
};

export const JOB_STATUS_TONE: Record<string, string> = {
  QUEUED: 'bg-ink-subtle/15 text-ink-muted',
  RUNNING: 'bg-brand/10 text-brand',
  COMPLETED: 'bg-positive/10 text-positive',
  COMPLETED_WITH_ERRORS: 'bg-caution/10 text-caution',
  FAILED: 'bg-negative/10 text-negative',
  CANCELLED: 'bg-ink-subtle/15 text-ink-muted',
};

export const JOB_TYPE_LABELS: Record<string, string> = {
  UPLOAD_IMPORT: 'Import from upload',
  REFRESH_SELECTED: 'Refresh selected',
  REFRESH_BATCH: 'Refresh batch',
  REFRESH_ALL: 'Refresh all',
  REFRESH_PLATFORM: 'Refresh platform',
  RETRY_FAILED: 'Retry failed',
};

/** Fallback colours; the live values come from settings so they stay tunable. */
export const FALLBACK_PLATFORM_COLORS: Record<Platform, string> = {
  LEETCODE: '#F89F1B',
  CODECHEF: '#5B4638',
  HACKERRANK: '#00EA64',
  CODEFORCES: '#1F8ACB',
};

export const PLATFORM_LABELS: Record<Platform, string> = {
  LEETCODE: 'LeetCode',
  CODECHEF: 'CodeChef',
  HACKERRANK: 'HackerRank',
  CODEFORCES: 'Codeforces',
};

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
}
