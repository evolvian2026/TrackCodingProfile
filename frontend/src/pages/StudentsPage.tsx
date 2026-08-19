import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, GitCompare, RefreshCw, Search } from 'lucide-react';
import { studentsApi } from '../api/endpoints';
import { downloadFile, errorMessage } from '../api/client';
import { useFilters } from '../hooks/useFilters';
import { useAuth } from '../hooks/useAuth';
import { FilterBar } from '../components/FilterBar';
import {
  Callout, Card, DataValue, EmptyState, ErrorState, LoadingBlock, PageHeader, Pagination, StatusBadge, useToast,
} from '../components/ui';
import { decimal, num, relativeTime } from '../lib/format';

const SORT_OPTIONS = [
  { value: 'cpScore', label: 'CP score' },
  { value: 'totalSolved', label: 'Problems solved' },
  { value: 'currentRating', label: 'Contest rating' },
  { value: 'totalContests', label: 'Contests' },
  { value: 'topicCount', label: 'Topics covered' },
  { value: 'name', label: 'Name' },
  { value: 'studentId', label: 'Student ID' },
];

export default function StudentsPage() {
  const { params, filters, setFilter } = useFilters();
  const { can } = useAuth();
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selected, setSelected] = useState<string[]>([]);

  const page = Number(searchParams.get('page') ?? 1);
  const sortBy = searchParams.get('sortBy') ?? 'cpScore';
  const sortDir = (searchParams.get('sortDir') ?? 'desc') as 'asc' | 'desc';

  const setParam = (key: string, value: string) => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set(key, value);
      if (key !== 'page') next.delete('page');
      return next;
    }, { replace: true });
  };

  const query = useQuery({
    queryKey: ['students', params, page, sortBy, sortDir],
    queryFn: () => studentsApi.list({ ...params, page, pageSize: 25, sortBy, sortDir }),
  });

  const refresh = useMutation({
    mutationFn: (studentIds: string[]) => studentsApi.refreshMany({ scope: 'selected', studentIds, force: true }),
    onSuccess: (job) => {
      notify(`Job #${job.number} queued — ${job.totalItems} profiles to fetch.`, 'success');
      setSelected([]);
      queryClient.invalidateQueries({ queryKey: ['students'] });
    },
    onError: (error) => notify(errorMessage(error), 'error'),
  });

  const rows = query.data?.data ?? [];
  const allSelected = rows.length > 0 && rows.every((row) => selected.includes(row.id));

  return (
    <>
      <PageHeader
        title="Students"
        subtitle={query.data ? `${num(query.data.pagination.total)} students match the current filters` : undefined}
        actions={
          <>
            {selected.length >= 2 && (
              <Link to={`/compare?ids=${selected.join(',')}`} className="btn-secondary">
                <GitCompare className="h-4 w-4" />
                Compare {selected.length}
              </Link>
            )}
            {can('TRAINER') && selected.length > 0 && (
              <button
                type="button"
                className="btn-secondary"
                disabled={refresh.isPending}
                onClick={() => refresh.mutate(selected)}
              >
                <RefreshCw className={`h-4 w-4 ${refresh.isPending ? 'animate-spin' : ''}`} />
                Refresh {selected.length}
              </button>
            )}
            <button
              type="button"
              className="btn-secondary"
              onClick={() =>
                downloadFile(
                  `/api/reports/leaderboard?format=xlsx&${new URLSearchParams(
                    Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][],
                  )}`,
                  'students.xlsx',
                ).catch((error) => notify(errorMessage(error), 'error'))
              }
            >
              <Download className="h-4 w-4" />
              Export
            </button>
          </>
        }
      />

      <FilterBar show={['college', 'batch', 'branch', 'section', 'platform', 'minSolved', 'minRating']}>
        <label className="flex flex-1 flex-col" style={{ minWidth: '12rem' }}>
          <span className="mb-1 text-2xs font-medium uppercase tracking-wide text-ink-subtle">Search</span>
          <span className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle" aria-hidden />
            <input
              type="search"
              className="input py-1.5 pl-8 text-xs"
              placeholder="Name, ID, email or handle"
              value={filters.search ?? ''}
              onChange={(event) => setFilter('search', event.target.value || undefined)}
            />
          </span>
        </label>

        <label className="flex flex-col">
          <span className="mb-1 text-2xs font-medium uppercase tracking-wide text-ink-subtle">Sort by</span>
          <select className="input py-1.5 text-xs" value={sortBy} onChange={(event) => setParam('sortBy', event.target.value)}>
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col">
          <span className="mb-1 text-2xs font-medium uppercase tracking-wide text-ink-subtle">Order</span>
          <select className="input py-1.5 text-xs" value={sortDir} onChange={(event) => setParam('sortDir', event.target.value)}>
            <option value="desc">Highest first</option>
            <option value="asc">Lowest first</option>
          </select>
        </label>
      </FilterBar>

      {refresh.isSuccess && (
        <div className="mb-4">
          <Callout tone="success">Refresh queued. Track it on the Processing page.</Callout>
        </div>
      )}

      <Card>
        {query.isLoading ? (
          <LoadingBlock rows={8} />
        ) : query.isError ? (
          <ErrorState message={errorMessage(query.error)} onRetry={() => query.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No students match these filters"
            description="Try clearing the filters, or upload a student list to get started."
            action={<Link to="/upload" className="btn-primary">Upload Excel</Link>}
          />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th className="w-10">
                      <input
                        type="checkbox"
                        aria-label="Select all on this page"
                        checked={allSelected}
                        onChange={(event) =>
                          setSelected(
                            event.target.checked
                              ? [...new Set([...selected, ...rows.map((r) => r.id)])]
                              : selected.filter((id) => !rows.some((r) => r.id === id)),
                          )
                        }
                      />
                    </th>
                    <th>Student</th>
                    <th>Batch / Branch</th>
                    <th>Platforms</th>
                    <th className="text-right">Solved</th>
                    <th className="text-right">Rating</th>
                    <th className="text-right">Contests</th>
                    <th className="text-right">Topics</th>
                    <th className="text-right">CP score</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((student) => {
                    const analytics = student.analytics;
                    const hasData = analytics?.hasData ?? false;
                    return (
                      <tr key={student.id}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Select ${student.name}`}
                            checked={selected.includes(student.id)}
                            onChange={(event) =>
                              setSelected(
                                event.target.checked
                                  ? [...selected, student.id]
                                  : selected.filter((id) => id !== student.id),
                              )
                            }
                          />
                        </td>
                        <td>
                          <Link to={`/students/${student.id}`} className="font-medium text-ink hover:text-brand">
                            {student.name}
                          </Link>
                          <span className="block text-xs text-ink-muted">{student.studentId}</span>
                        </td>
                        <td className="text-xs text-ink-muted">
                          {[student.batch, student.branch, student.section].filter(Boolean).join(' · ') || '—'}
                        </td>
                        <td>
                          <div className="flex flex-wrap gap-1">
                            {student.platforms.length === 0 ? (
                              <span className="text-xs text-ink-subtle">No handles</span>
                            ) : (
                              student.platforms.map((platform) => (
                                <span
                                  key={platform.platform}
                                  title={`${platform.label}: ${platform.username}${platform.statusMessage ? ` — ${platform.statusMessage}` : ''}`}
                                >
                                  <StatusBadge status={platform.status} message={`${platform.label} (${platform.username})`} />
                                </span>
                              ))
                            )}
                          </div>
                        </td>
                        <td className="text-right"><DataValue value={hasData ? analytics!.totalSolved : null} reason="No platform returned data for this student yet." /></td>
                        <td className="text-right"><DataValue value={analytics?.currentRating ?? null} reason="No platform published a contest rating." /></td>
                        <td className="text-right">
                          <DataValue
                            value={analytics?.contestsKnown ? analytics.totalContests : null}
                            reason="No platform with data for this student publishes contest participation."
                          />
                        </td>
                        <td className="text-right">
                          <DataValue
                            value={analytics?.topicsKnown ? analytics.topicCount : null}
                            reason="No platform with data for this student publishes a topic breakdown."
                          />
                        </td>
                        <td className="tabular text-right font-medium">
                          {hasData ? decimal(analytics!.cpScore, 0) : <span className="text-ink-subtle">N/A</span>}
                        </td>
                        <td className="whitespace-nowrap text-xs text-ink-muted">
                          {relativeTime(
                            student.platforms
                              .map((p) => p.lastSuccessAt)
                              .filter(Boolean)
                              .sort()
                              .at(-1) ?? null,
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              page={query.data!.pagination.page}
              totalPages={query.data!.pagination.totalPages}
              total={query.data!.pagination.total}
              pageSize={query.data!.pagination.pageSize}
              onChange={(next) => setParam('page', String(next))}
            />
          </>
        )}
      </Card>
    </>
  );
}
