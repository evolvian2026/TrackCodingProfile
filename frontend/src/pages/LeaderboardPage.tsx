import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowDown, ArrowUp, Download } from 'lucide-react';
import { leaderboardApi } from '../api/endpoints';
import { downloadFile, errorMessage } from '../api/client';
import { useFilters } from '../hooks/useFilters';
import { FilterBar } from '../components/FilterBar';
import { Card, DataValue, EmptyState, ErrorState, LoadingBlock, PageHeader, Pagination, useToast } from '../components/ui';
import { decimal, num, percent } from '../lib/format';

const COLUMNS = [
  { key: 'name', label: 'Student', sortable: false },
  { key: 'college', label: 'College', sortable: false },
  { key: 'batch', label: 'Batch', sortable: false },
  { key: 'totalSolved', label: 'Solved', sortable: true, numeric: true },
  { key: 'currentRating', label: 'Rating', sortable: true, numeric: true },
  { key: 'totalContests', label: 'Contests', sortable: true, numeric: true },
  { key: 'topicCount', label: 'Topics', sortable: true, numeric: true },
  { key: 'cpScore', label: 'CP score', sortable: true, numeric: true },
] as const;

const SIZES = [10, 50, 100, 250];

export default function LeaderboardPage() {
  const { params } = useFilters();
  const { notify } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [pageSize, setPageSize] = useState(50);

  const page = Number(searchParams.get('page') ?? 1);
  const sortBy = searchParams.get('sortBy') ?? 'cpScore';
  const sortDir = (searchParams.get('sortDir') ?? 'desc') as 'asc' | 'desc';

  const setParam = (key: string, value: string) =>
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set(key, value);
      if (key !== 'page') next.delete('page');
      return next;
    }, { replace: true });

  const query = useQuery({
    queryKey: ['leaderboard', params, page, pageSize, sortBy, sortDir],
    queryFn: () => leaderboardApi.get({ ...params, page, pageSize, sortBy, sortDir }),
  });

  const toggleSort = (key: string) => {
    if (sortBy === key) setParam('sortDir', sortDir === 'desc' ? 'asc' : 'desc');
    else {
      setParam('sortBy', key);
      setParam('sortDir', 'desc');
    }
  };

  return (
    <>
      <PageHeader
        title="Leaderboard"
        subtitle="Ranked by Competitive Programming Score. Students with no retrieved data are excluded rather than ranked as zero."
        actions={
          <>
            <select className="input w-auto py-2 text-sm" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
              {SIZES.map((size) => <option key={size} value={size}>Top {size}</option>)}
            </select>
            {(['xlsx', 'csv'] as const).map((format) => (
              <button
                key={format}
                type="button"
                className="btn-secondary"
                onClick={() =>
                  downloadFile(
                    `/api/reports/leaderboard?format=${format}&${new URLSearchParams(
                      Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][],
                    )}`,
                    `leaderboard.${format}`,
                  ).catch((error) => notify(errorMessage(error), 'error'))
                }
              >
                <Download className="h-4 w-4" />
                {format.toUpperCase()}
              </button>
            ))}
          </>
        }
      />

      <FilterBar show={['college', 'batch', 'branch', 'section', 'platform', 'minSolved', 'minRating', 'minContests']} />

      <Card>
        {query.isLoading ? (
          <LoadingBlock rows={10} />
        ) : query.isError ? (
          <ErrorState message={errorMessage(query.error)} onRetry={() => query.refetch()} />
        ) : query.data!.data.length === 0 ? (
          <EmptyState
            title="No ranked students"
            description="Students appear here once at least one platform has returned data for them."
            action={<Link to="/upload" className="btn-primary">Upload students</Link>}
          />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th className="w-14 text-right">Rank</th>
                    {COLUMNS.map((column) => (
                      <th key={column.key} className={clsx('numeric' in column && column.numeric && 'text-right')}>
                        {column.sortable ? (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 hover:text-ink"
                            onClick={() => toggleSort(column.key)}
                          >
                            {column.label}
                            {sortBy === column.key &&
                              (sortDir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
                          </button>
                        ) : (
                          column.label
                        )}
                      </th>
                    ))}
                    <th className="text-right">Coverage</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data!.data.map((row) => (
                    <tr key={row.id}>
                      <td className="tabular text-right">
                        <span className={clsx('font-semibold', row.rank <= 3 ? 'text-brand' : 'text-ink-muted')}>{row.rank}</span>
                      </td>
                      <td>
                        <Link to={`/students/${row.id}`} className="font-medium text-ink hover:text-brand">{row.name}</Link>
                        <span className="block text-xs text-ink-muted">{row.studentId}</span>
                      </td>
                      <td className="max-w-[14rem] truncate text-xs text-ink-muted" title={row.college ?? ''}>{row.college ?? '—'}</td>
                      <td className="text-xs text-ink-muted">{[row.batch, row.branch].filter(Boolean).join(' · ') || '—'}</td>
                      <td className="text-right">
                        <span className="tabular font-medium">{num(row.totalSolved)}</span>
                        <span className="block text-2xs text-ink-subtle">
                          {row.difficultyKnown
                            ? `${num(row.easySolved)}E · ${num(row.mediumSolved)}M · ${num(row.hardSolved)}H`
                            : 'no difficulty split published'}
                        </span>
                      </td>
                      <td className="text-right"><DataValue value={row.currentRating} reason="No platform published a contest rating for this student." /></td>
                      <td className="text-right"><DataValue value={row.contestsKnown ? row.totalContests : null} /></td>
                      <td className="text-right"><DataValue value={row.topicsKnown ? row.topicCount : null} /></td>
                      <td className="tabular text-right font-semibold">{decimal(row.cpScore, 1)}</td>
                      <td className="tabular text-right text-xs text-ink-muted">
                        {row.topicsKnown ? percent(row.topicCoverage, 0) : <span className="text-ink-subtle">N/A</span>}
                      </td>
                    </tr>
                  ))}
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
