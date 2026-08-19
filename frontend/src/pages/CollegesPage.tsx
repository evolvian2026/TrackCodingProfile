import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { analyticsApi } from '../api/endpoints';
import { errorMessage } from '../api/client';
import { useFilters } from '../hooks/useFilters';
import { FilterBar } from '../components/FilterBar';
import { Card, CardHeader, DataValue, EmptyState, ErrorState, LoadingBlock, PageHeader } from '../components/ui';
import { CategoryBars } from '../components/charts';
import { decimal, num } from '../lib/format';

export default function CollegesPage() {
  const { params } = useFilters();
  const [groupBy, setGroupBy] = useState<'college' | 'university'>('college');

  const query = useQuery({
    queryKey: ['institutions', groupBy, params],
    queryFn: () => analyticsApi.institutions(groupBy, params),
  });

  return (
    <>
      <PageHeader
        title="Institution comparison"
        subtitle="Compare colleges or universities on average performance."
        actions={
          <select className="input w-auto py-2 text-sm" value={groupBy} onChange={(event) => setGroupBy(event.target.value as 'college' | 'university')}>
            <option value="college">By college</option>
            <option value="university">By university</option>
          </select>
        }
      />

      <FilterBar show={['batch', 'branch', 'platform']} />

      {query.isLoading ? (
        <LoadingBlock rows={8} />
      ) : query.isError ? (
        <ErrorState message={errorMessage(query.error)} onRetry={() => query.refetch()} />
      ) : (query.data?.length ?? 0) === 0 ? (
        <Card><EmptyState title="No institutions found" description={`Import students with a ${groupBy} column to use this comparison.`} /></Card>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          <Card>
            <CardHeader title="Average CP score" subtitle="Higher is stronger overall" />
            <div className="p-5">
              <CategoryBars data={query.data!.map((row) => ({ label: row.name, value: Math.round(row.averageScore * 10) / 10 }))} valueLabel="Average score" />
            </div>
          </Card>

          <Card>
            <CardHeader title="Average problems solved" />
            <div className="p-5">
              <CategoryBars data={query.data!.map((row) => ({ label: row.name, value: Math.round(row.averageProblemsSolved) }))} />
            </div>
          </Card>

          <Card className="xl:col-span-2">
            <CardHeader title="Comparison table" />
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Institution</th><th className="text-right">Students</th><th className="text-right">With data</th>
                    <th className="text-right">Avg solved</th><th className="text-right">Avg rating</th>
                    <th className="text-right">Avg contests</th><th className="text-right">Avg topics</th><th className="text-right">Avg CP score</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data!.map((row) => (
                    <tr key={row.name}>
                      <td className="font-medium">{row.name}</td>
                      <td className="tabular text-right">{num(row.studentCount)}</td>
                      <td className="tabular text-right text-ink-muted">{num(row.studentsWithData)}</td>
                      <td className="tabular text-right">{decimal(row.averageProblemsSolved, 0)}</td>
                      <td className="text-right"><DataValue value={row.averageRating} reason="No student at this institution has a published rating." /></td>
                      <td className="tabular text-right">{decimal(row.averageContests, 1)}</td>
                      <td className="tabular text-right">{decimal(row.averageTopicCoverage, 1)}</td>
                      <td className="tabular text-right font-semibold">{decimal(row.averageScore, 1)}</td>
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
