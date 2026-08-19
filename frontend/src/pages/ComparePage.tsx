import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import { studentsApi } from '../api/endpoints';
import { errorMessage } from '../api/client';
import { Card, CardHeader, DataValue, EmptyState, ErrorState, LoadingBlock, PageHeader, SkillBadge } from '../components/ui';
import { CategoryBars } from '../components/charts';
import { decimal, num } from '../lib/format';
import type { SkillLevel, StudentAnalytics, TopicCount } from '../types/api';

interface ComparisonRow {
  id: string;
  studentId: string;
  name: string;
  college: string | null;
  batch: string | null;
  branch: string | null;
  analytics: StudentAnalytics | null;
  topics: TopicCount[];
  skills: { id: string; topic: string; level: SkillLevel; problemsSolved: number }[];
  platforms: { platform: string; label: string; status: string; totalSolved: number | null; rating: number | null; contestsAttended: number | null }[];
}

export default function ComparePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const ids = useMemo(() => (searchParams.get('ids') ?? '').split(',').filter(Boolean), [searchParams]);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const search = useQuery({
    queryKey: ['compare-search', debounced],
    queryFn: () => studentsApi.search(debounced),
    enabled: debounced.length >= 2,
  });

  const comparison = useQuery({
    queryKey: ['compare', ids],
    queryFn: () => studentsApi.compare(ids) as Promise<ComparisonRow[]>,
    enabled: ids.length >= 2,
  });

  const setIds = (next: string[]) =>
    setSearchParams(next.length > 0 ? { ids: next.join(',') } : {}, { replace: true });

  const rows = comparison.data ?? [];

  return (
    <>
      <PageHeader title="Compare students" subtitle="Select two or more students to compare side by side." />

      <Card className="mb-5 p-4">
        <label className="mb-2 block">
          <span className="label">Add a student</span>
          <span className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" aria-hidden />
            <input
              type="search"
              className="input pl-9"
              placeholder="Search by name, ID or handle…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </span>
        </label>

        {debounced.length >= 2 && (
          <div className="mb-3 max-h-48 overflow-y-auto rounded-lg border border-line">
            {(search.data ?? []).length === 0 ? (
              <p className="px-3 py-2 text-sm text-ink-muted">No matches.</p>
            ) : (
              (search.data ?? []).map((student) => (
                <button
                  key={student.id}
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-surface-muted disabled:opacity-50"
                  disabled={ids.includes(student.id) || ids.length >= 10}
                  onClick={() => {
                    setIds([...ids, student.id]);
                    setQuery('');
                  }}
                >
                  <span>
                    <span className="font-medium text-ink">{student.name}</span>
                    <span className="ml-2 text-xs text-ink-muted">{student.studentId}</span>
                  </span>
                  <span className="text-xs text-ink-subtle">{ids.includes(student.id) ? 'Added' : 'Add'}</span>
                </button>
              ))
            )}
          </div>
        )}

        {ids.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {rows.map((student) => (
              <span key={student.id} className="flex items-center gap-1.5 rounded-full bg-surface-muted px-2.5 py-1 text-xs">
                {student.name}
                <button type="button" onClick={() => setIds(ids.filter((id) => id !== student.id))} aria-label={`Remove ${student.name}`}>
                  <X className="h-3 w-3 text-ink-subtle hover:text-ink" />
                </button>
              </span>
            ))}
            <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setIds([])}>Clear all</button>
          </div>
        )}
      </Card>

      {ids.length < 2 ? (
        <Card>
          <EmptyState
            title="Select at least two students"
            description="Use the search box above, or select students from the Students page and click Compare."
            action={<Link to="/students" className="btn-primary">Go to students</Link>}
          />
        </Card>
      ) : comparison.isLoading ? (
        <LoadingBlock rows={8} />
      ) : comparison.isError ? (
        <ErrorState message={errorMessage(comparison.error)} onRetry={() => comparison.refetch()} />
      ) : (
        <div className="space-y-5">
          <Card>
            <CardHeader title="Side by side" />
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Metric</th>
                    {rows.map((student) => (
                      <th key={student.id} className="text-right">
                        <Link to={`/students/${student.id}`} className="text-brand hover:underline">{student.name}</Link>
                        <span className="mt-0.5 block font-normal normal-case text-ink-subtle">
                          {[student.branch, student.batch].filter(Boolean).join(' · ')}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {([
                    ['Problems solved', (a: StudentAnalytics | null) => (a?.hasData ? a.totalSolved : null)],
                    ['Easy', (a: StudentAnalytics | null) => (a?.difficultyKnown ? a.easySolved : null)],
                    ['Medium', (a: StudentAnalytics | null) => (a?.difficultyKnown ? a.mediumSolved : null)],
                    ['Hard', (a: StudentAnalytics | null) => (a?.difficultyKnown ? a.hardSolved : null)],
                    ['Contests', (a: StudentAnalytics | null) => (a?.contestsKnown ? a.totalContests : null)],
                    ['Best rank', (a: StudentAnalytics | null) => a?.bestRank ?? null],
                    ['Current rating', (a: StudentAnalytics | null) => a?.currentRating ?? null],
                    ['Peak rating', (a: StudentAnalytics | null) => a?.bestRating ?? null],
                    ['Topics covered', (a: StudentAnalytics | null) => (a?.topicsKnown ? a.topicCount : null)],
                    ['Platforms with data', (a: StudentAnalytics | null) => (a?.hasData ? a.platformsActive : null)],
                  ] as const).map(([label, pick]) => (
                    <tr key={label}>
                      <td className="font-medium text-ink-muted">{label}</td>
                      {rows.map((student) => (
                        <td key={student.id} className="text-right"><DataValue value={pick(student.analytics)} /></td>
                      ))}
                    </tr>
                  ))}
                  <tr>
                    <td className="font-semibold">CP score</td>
                    {rows.map((student) => (
                      <td key={student.id} className="tabular text-right font-semibold">
                        {student.analytics?.hasData ? decimal(student.analytics.cpScore, 1) : <span className="text-ink-subtle">N/A</span>}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            {rows.map((student) => (
              <Card key={student.id}>
                <CardHeader title={student.name} subtitle="Top topics" />
                <div className="p-5">
                  {student.topics.length === 0 ? (
                    <EmptyState title="No topic data" />
                  ) : (
                    <CategoryBars data={student.topics.slice(0, 10).map((topic) => ({ label: topic.topic, value: topic.problemsSolved }))} />
                  )}
                </div>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader title="Skill comparison" subtitle="Levels across the topics these students have practised" />
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Skill</th>
                    {rows.map((student) => <th key={student.id}>{student.name}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {[...new Set(rows.flatMap((student) => student.skills.map((skill) => skill.topic)))]
                    .slice(0, 20)
                    .map((topic) => (
                      <tr key={topic}>
                        <td className="font-medium">{topic}</td>
                        {rows.map((student) => {
                          const skill = student.skills.find((entry) => entry.topic === topic);
                          return (
                            <td key={student.id}>
                              {skill ? (
                                <span className="flex items-center gap-2">
                                  <SkillBadge level={skill.level} />
                                  <span className="tabular text-xs text-ink-muted">{num(skill.problemsSolved)}</span>
                                </span>
                              ) : (
                                <span className="text-xs text-ink-subtle">N/A</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
