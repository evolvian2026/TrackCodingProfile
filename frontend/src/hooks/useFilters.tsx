import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Platform } from '../types/api';

export interface GlobalFilters {
  university?: string;
  college?: string;
  batch?: string;
  branch?: string;
  section?: string;
  platform?: Platform;
  search?: string;
  minRating?: number;
  maxRating?: number;
  minSolved?: number;
  maxSolved?: number;
  minContests?: number;
}

interface FiltersContextValue {
  filters: GlobalFilters;
  setFilter: (key: keyof GlobalFilters, value: string | number | undefined) => void;
  clearFilters: () => void;
  activeCount: number;
  /** Filters as query params, ready to pass to the API layer. */
  params: Record<string, string | number | undefined>;
}

const FiltersContext = createContext<FiltersContextValue | null>(null);

const NUMERIC_KEYS: (keyof GlobalFilters)[] = ['minRating', 'maxRating', 'minSolved', 'maxSolved', 'minContests'];

/**
 * Global filters live in the URL so a filtered view can be bookmarked, shared
 * and survives a reload — and every dashboard reads from the same source.
 */
export function FiltersProvider({ children }: { children: ReactNode }) {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters = useMemo<GlobalFilters>(() => {
    const result: GlobalFilters = {};
    for (const key of ['university', 'college', 'batch', 'branch', 'section', 'platform', 'search'] as const) {
      const value = searchParams.get(key);
      if (value) result[key] = value as never;
    }
    for (const key of NUMERIC_KEYS) {
      const value = searchParams.get(key);
      if (value !== null && value !== '' && Number.isFinite(Number(value))) result[key] = Number(value) as never;
    }
    return result;
  }, [searchParams]);

  const setFilter = useCallback(
    (key: keyof GlobalFilters, value: string | number | undefined) => {
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          if (value === undefined || value === '' || value === 'all') next.delete(key);
          else next.set(key, String(value));
          // Any filter change invalidates the current page.
          next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const clearFilters = useCallback(() => {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const key of ['university', 'college', 'batch', 'branch', 'section', 'platform', 'search', ...NUMERIC_KEYS]) {
          next.delete(key);
        }
        next.delete('page');
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  const value = useMemo<FiltersContextValue>(
    () => ({
      filters,
      setFilter,
      clearFilters,
      activeCount: Object.values(filters).filter((v) => v !== undefined && v !== '').length,
      params: filters as Record<string, string | number | undefined>,
    }),
    [filters, setFilter, clearFilters],
  );

  return <FiltersContext.Provider value={value}>{children}</FiltersContext.Provider>;
}

export function useFilters(): FiltersContextValue {
  const context = useContext(FiltersContext);
  if (!context) throw new Error('useFilters must be used inside a FiltersProvider');
  return context;
}
