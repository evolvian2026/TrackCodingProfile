import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { analyticsApi } from '../api/endpoints';
import { downloadFile, errorMessage } from '../api/client';
import { useFilterOptions } from '../components/FilterBar';
import { Card, CardHeader, DataValue, EmptyState, ErrorState, LoadingBlock, PageHeader, ProgressBar, StatCard, useToast } from '../components/ui';
import { CategoryBars } from '../components/charts';
import { decimal, num, percent } from '../lib/format';

export default function BatchPage() {
  const { data: options } = useFilterOptions();
  const [batch, setBatch] = useState('');
  const { notify } = useToast();

  // Default to the first batch once the option list arrives.
  useEffect(() => {
    if (!batch && options?.batches.length) setBatch(options.batches[0]!);
  }, [options, batch]);

  const query = useQuery({
    queryKey: ['batch-analytics', batch],
    queryFn: () => analyticsApi.batch(batch),
    enabled: Boolean(batch),
  });

  return (
    <>
      <PageHeader
        title="Batch dashboard"
        subtitle="Cohort-level performance, strengths and weaknesses."
        actions={
          <>
            <select className="input w-auto py-2 text-sm" value={batch} onChange={(event) => setBatch(event.target.value)}>
              {(options?.batches ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
            {batch && (['pdf', 'xlsx'] as const).map((format) => (
              <button
                key={format}
                type="button"
                className="btn-secondary"
                onClick={() => downloadFile(`/api/reports/batch/${encodeURIComponent(batch)}?format=${format}`, `batch-${batch}.${format}`).catch((e) => notify(errorMessage(e), 'error'))}
              >
                <Download className="h-4 w-4" />
                {format.toUpperCase()}
              </button>
            ))}
          </>
        }
      />

      {!batch ? (
        <Card><EmptyState title="No batches found" description="Import students with a batch column to use this dashboard." /></Card>
      ) : query.isLoading ? (
        <LoadingBlock rows={8} />
      ) : query.isError ? (
        <ErrorState message={errorMessage(query.error)} onRetry={() => query.refetch()} />
      ) : (
        <BatchContent data={query.data!} />
      )}
    </>
  );
}

function BatchContent({ data }: { data: Awaited<ReturnType<typeof analyticsApi.batch>> }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Students" value={num(data.studentCount)} hint={`${num(data.studentsWithData)} with data`} />
        <StatCard label="Avg problems solved" value={<DataValue value={data.averages.problemsSolved.average} />} hint={`Median ${decimal(data.averages.problemsSolved.median)}`} />
        <StatCard label="Avg contest rating" value={<DataValue value={data.averages.contestRating.average} />} hint={data.averages.contestRating.count > 0 ? `${num(data.averages.contestRating.count)} rated students` : 'No ratings published'} />
        <StatCard label="Avg contests" value={<DataValue value={data.averages.contestParticipation.average} />} />
        <StatCard label="Avg CP score" value={<DataValue value={data.averages.cpScore.average} />} hint={`Top ${decimal(data.averages.cpScore.max)}`} />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {([
          { label: 'Top CP score', student: data.highlights.topStudent, metric: (s: typeof data.highlights.topStudent) => decimal(s!.cpScore, 1) },
          { label: 'Most problems solved', student: data.highlights.mostProblemsSolved, metric: (s: typeof data.highlights.topStudent) => num(s!.totalSolved) },
          { label: 'Highest rating', student: data.highlights.highestRating, metric: (s: typeof data.highlights.topStudent) => num(s!.bestRating) },
        ] as const).map((highlight) => (
          <Card key={highlight.label} className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{highlight.label}</p>
            {highlight.student ? (
              <>
                <Link to={`/students/${highlight.student.id}`} className="mt-1.5 block text-base font-semibold text-ink hover:text-brand">
                  {highlight.student.name}
                </Link>
                <p className="tabular mt-0.5 text-sm text-ink-muted">{highlight.metric(highlight.student)}</p>
              </>
            ) : (
              <p className="mt-1.5 text-sm text-ink-subtle">N/A</p>
            )}
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader title="Platform adoption" subtitle="Share of the batch with a linked handle on each platform" />
        <div className="space-y-3 p-5">
          {data.platformAdoption.map((platform) => (
            <div key={platform.platform} className="flex items-center gap-3">
              <span className="flex w-32 items-center gap-2 text-sm font-medium text-ink">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: platform.color }} aria-hidden />
                {platform.label}
              </span>
              <div className="flex-1"><ProgressBar value={platform.linked} max={Math.max(1, data.studentCount)} color={platform.color} /></div>
              <span className="tabular w-32 text-right text-xs text-ink-muted">
                {num(platform.linked)} linked · {percent(platform.adoptionRate, 0)}
              </span>
              <span className="tabular w-24 text-right text-xs text-ink-muted">{num(platform.available)} with data</span>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Strongest topics" subtitle="Where the batch has solved the most" />
          <div className="p-5"><CategoryBars data={data.strengths.map((t) => ({ label: t.topic, value: t.problemsSolved }))} /></div>
        </Card>
        <Card>
          <CardHeader title="Weakest topics" subtitle="Least practised across the batch" />
          <div className="p-5"><CategoryBars data={data.weaknesses.map((t) => ({ label: t.topic, value: t.problemsSolved }))} /></div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <RankTable title="Top 10 students" rows={data.top10} />
        <RankTable title="Bottom 10 students" subtitle="Candidates for additional support" rows={data.bottom10} />
      </div>
    </div>
  );
}

function RankTable({ title, subtitle, rows }: { title: string; subtitle?: string; rows: Awaited<ReturnType<typeof analyticsApi.batch>>['top10'] }) {
  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} />
      {rows.length === 0 ? (
        <EmptyState title="No ranked students" />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>#</th><th>Student</th><th className="text-right">Solved</th><th className="text-right">Rating</th><th className="text-right">Score</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="tabular text-ink-subtle">{row.rank}</td>
                  <td><Link to={`/students/${row.id}`} className="font-medium hover:text-brand">{row.name}</Link></td>
                  <td className="tabular text-right">{num(row.totalSolved)}</td>
                  <td className="text-right"><DataValue value={row.currentRating} /></td>
                  <td className="tabular text-right font-medium">{decimal(row.cpScore, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
