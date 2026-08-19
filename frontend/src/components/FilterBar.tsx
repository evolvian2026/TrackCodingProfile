import { useQuery } from '@tanstack/react-query';
import { Filter, X } from 'lucide-react';
import { studentsApi } from '../api/endpoints';
import { useFilters, type GlobalFilters } from '../hooks/useFilters';
import type { Platform } from '../types/api';

export function useFilterOptions() {
  return useQuery({ queryKey: ['filter-options'], queryFn: studentsApi.filters, staleTime: 300_000 });
}

interface FilterBarProps {
  /** Which controls to show — dashboards differ in what makes sense. */
  show?: (keyof GlobalFilters)[];
  children?: React.ReactNode;
}

const DEFAULT_SHOW: (keyof GlobalFilters)[] = ['college', 'batch', 'branch', 'section', 'platform'];

/**
 * Global filters, backed by the URL, applied consistently by every dashboard.
 */
export function FilterBar({ show = DEFAULT_SHOW, children }: FilterBarProps) {
  const { filters, setFilter, clearFilters, activeCount } = useFilters();
  const { data: options } = useFilterOptions();

  const select = (
    key: keyof GlobalFilters,
    label: string,
    values: string[] | undefined,
  ) => (
    <label key={key} className="flex min-w-0 flex-col">
      <span className="mb-1 text-2xs font-medium uppercase tracking-wide text-ink-subtle">{label}</span>
      <select
        className="input py-1.5 text-xs"
        value={(filters[key] as string) ?? ''}
        onChange={(event) => setFilter(key, event.target.value || undefined)}
        disabled={!values || values.length === 0}
      >
        <option value="">All {label.toLowerCase()}</option>
        {(values ?? []).map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="card mb-5 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <span className="flex items-center gap-1.5 pb-2 text-xs font-medium text-ink-muted">
          <Filter className="h-3.5 w-3.5" aria-hidden />
          Filters
        </span>

        {show.includes('university') && select('university', 'University', options?.universities)}
        {show.includes('college') && select('college', 'College', options?.colleges)}
        {show.includes('batch') && select('batch', 'Batch', options?.batches)}
        {show.includes('branch') && select('branch', 'Branch', options?.branches)}
        {show.includes('section') && select('section', 'Section', options?.sections)}

        {show.includes('platform') && (
          <label className="flex flex-col">
            <span className="mb-1 text-2xs font-medium uppercase tracking-wide text-ink-subtle">Platform</span>
            <select
              className="input py-1.5 text-xs"
              value={filters.platform ?? ''}
              onChange={(event) => setFilter('platform', (event.target.value as Platform) || undefined)}
            >
              <option value="">All platforms</option>
              {(options?.platforms ?? []).map((platform) => (
                <option key={platform.key} value={platform.key}>
                  {platform.label}
                </option>
              ))}
            </select>
          </label>
        )}

        {show.includes('minSolved') && (
          <label className="flex w-28 flex-col">
            <span className="mb-1 text-2xs font-medium uppercase tracking-wide text-ink-subtle">Min solved</span>
            <input
              type="number"
              min={0}
              className="input py-1.5 text-xs"
              value={filters.minSolved ?? ''}
              onChange={(event) => setFilter('minSolved', event.target.value ? Number(event.target.value) : undefined)}
            />
          </label>
        )}

        {show.includes('minRating') && (
          <label className="flex w-28 flex-col">
            <span className="mb-1 text-2xs font-medium uppercase tracking-wide text-ink-subtle">Min rating</span>
            <input
              type="number"
              min={0}
              className="input py-1.5 text-xs"
              value={filters.minRating ?? ''}
              onChange={(event) => setFilter('minRating', event.target.value ? Number(event.target.value) : undefined)}
            />
          </label>
        )}

        {show.includes('minContests') && (
          <label className="flex w-28 flex-col">
            <span className="mb-1 text-2xs font-medium uppercase tracking-wide text-ink-subtle">Min contests</span>
            <input
              type="number"
              min={0}
              className="input py-1.5 text-xs"
              value={filters.minContests ?? ''}
              onChange={(event) => setFilter('minContests', event.target.value ? Number(event.target.value) : undefined)}
            />
          </label>
        )}

        {children}

        {activeCount > 0 && (
          <button type="button" className="btn-ghost ml-auto px-2.5 py-1.5 text-xs" onClick={clearFilters}>
            <X className="h-3.5 w-3.5" />
            Clear {activeCount} filter{activeCount === 1 ? '' : 's'}
          </button>
        )}
      </div>
    </div>
  );
}
