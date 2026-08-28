import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Database, ShieldAlert, Trophy, Users } from 'lucide-react';
import { alertsApi, analyticsApi, leaderboardApi } from '../api/endpoints';
import { useFilters } from '../hooks/useFilters';
import { useTheme } from '../hooks/useTheme';
import { FilterBar } from '../components/FilterBar';
import { Card, CardHeader, Callout, DataValue, EmptyState, ErrorState, LoadingBlock, PageHeader, ProgressBar, StatCard, StatusBadge } from '../components/ui';
import { CategoryBars, CompositionBar, MultiLineChart } from '../components/charts';
import { errorMessage } from '../api/client';
import { decimal, num, relativeTime, JOB_STATUS_TONE, JOB_TYPE_LABELS } from '../lib/format';
import { difficultyColor } from '../lib/palette';

export default function DashboardPage() {
  const { params } = useFilters();
  const { mode } = useTheme();

  const overview = useQuery({ queryKey: ['overview', params], queryFn: () => analyticsApi.overview(params) });
  const difficulty = useQuery({ queryKey: ['difficulty', params], queryFn: () => analyticsApi.difficulty(params) });
  const topics = useQuery({ queryKey: ['topics', params], queryFn: () => analyticsApi.topics(params) });
  const growth = useQuery({ queryKey: ['growth', params], queryFn: () => analyticsApi.growth({ ...params, days: 90 }) });
  const top = useQuery({ queryKey: ['leaderboard-top', params], queryFn: () => leaderboardApi.get({ ...params, pageSize: 5 }) });
  const alerts = useQuery({ queryKey: ['alert-summary', params], queryFn: () => alertsApi.summary(params) });

  if (overview.isError) {
    return <ErrorState message={errorMessage(overview.error)} onRetry={() => overview.refetch()} />;
  }

  const data = overview.data;
  const scoreDist = data?.distributions.cpScore;

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Aggregated competitive programming performance across all tracked platforms."
      />

      <FilterBar />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Students tracked"
          value={overview.isLoading ? '—' : num(data?.totalStudents)}
          hint={data ? `${num(data.studentsWithData)} with retrieved data` : undefined}
          icon={<Users className="h-4 w-4" />}
        />
        <StatCard
          label="Average CP score"
          value={overview.isLoading ? '—' : <DataValue value={scoreDist?.average ?? null} />}
          hint={scoreDist ? `Median ${decimal(scoreDist.median)} · Top ${decimal(scoreDist.max)}` : undefined}
          icon={<Trophy className="h-4 w-4" />}
        />
        <StatCard
          label="Average problems solved"
          value={overview.isLoading ? '—' : <DataValue value={data?.distributions.problemsSolved?.average ?? null} />}
          hint={data ? `Across ${num(data.distributions.problemsSolved?.count)} students with data` : undefined}
          icon={<Database className="h-4 w-4" />}
        />
        <StatCard
          label="Needs attention"
          value={alerts.isLoading ? '—' : num(alerts.data?.unacknowledged)}
          hint={
            alerts.data && alerts.data.unacknowledged > 0
              ? alerts.data.byType.slice(0, 2).map((t) => t.label).join(', ')
              : 'Nobody is flagged'
          }
          accent={alerts.data && alerts.data.unacknowledged > 0 ? 'rgb(var(--caution))' : undefined}
          icon={<ShieldAlert className="h-4 w-4" />}
        />
      </div>

      {alerts.data && alerts.data.unacknowledged > 0 && (
        <div className="mb-5">
          <Callout tone="warning" title={`${num(alerts.data.unacknowledged)} students need attention`}>
            {alerts.data.byType.slice(0, 3).map((t) => `${t.count} ${t.label.toLowerCase()}`).join(' · ')}.{' '}
            <Link to="/alerts" className="font-medium text-brand underline-offset-2 hover:underline">
              Review the list
            </Link>
            .
          </Callout>
        </div>
      )}

      {data && data.studentsWithoutData > 0 && (
        <div className="mb-5">
          <Callout tone="warning" title={`${num(data.studentsWithoutData)} students have no retrieved data`}>
            They are excluded from averages and leaderboards rather than counted as zero.{' '}
            <Link to="/jobs" className="font-medium text-brand underline-offset-2 hover:underline">
              Review processing failures
            </Link>
            .
          </Callout>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-3">
        {/* Platform coverage */}
        <Card className="xl:col-span-2">
          <CardHeader
            title="Platform coverage"
            subtitle={
              data && data.activeJobs > 0
                ? `How many linked profiles returned public data · ${num(data.activeJobs)} job${data.activeJobs === 1 ? '' : 's'} running`
                : 'How many linked profiles actually returned public data'
            }
            actions={<Link to="/platforms" className="text-xs font-medium text-brand hover:underline">Details</Link>}
          />
          {overview.isLoading ? (
            <LoadingBlock rows={4} />
          ) : (
            <div className="divide-y divide-line">
              {data?.platforms.map((platform) => (
                <div key={platform.platform} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <span className="flex min-w-[7.5rem] items-center gap-2 text-sm font-medium text-ink">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: platform.color }} aria-hidden />
                    {platform.label}
                  </span>
                  <div className="min-w-[10rem] flex-1">
                    <ProgressBar
                      value={platform.available}
                      max={Math.max(1, platform.linked)}
                      color={platform.color}
                    />
                  </div>
                  <span className="tabular w-28 text-right text-xs text-ink-muted">
                    {num(platform.available)} / {num(platform.linked)} available
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {platform.notFound > 0 && <StatusBadge status="NOT_FOUND" message={`${platform.notFound} not found`} />}
                    {platform.private > 0 && <StatusBadge status="PRIVATE" message={`${platform.private} private`} />}
                    {platform.rateLimited > 0 && <StatusBadge status="RATE_LIMITED" message={`${platform.rateLimited} rate limited`} />}
                    {platform.error > 0 && <StatusBadge status="ERROR" message={`${platform.error} errored`} />}
                    {platform.pending > 0 && <StatusBadge status="PENDING" message={`${platform.pending} not fetched`} />}
                  </div>
                  <span className="w-full text-2xs text-ink-subtle sm:w-auto">
                    Updated {relativeTime(platform.lastRefreshedAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Top performers */}
        <Card>
          <CardHeader
            title="Top performers"
            subtitle="By Competitive Programming Score"
            actions={<Link to="/leaderboard" className="text-xs font-medium text-brand hover:underline">Full leaderboard</Link>}
          />
          {top.isLoading ? (
            <LoadingBlock rows={5} />
          ) : (top.data?.data.length ?? 0) === 0 ? (
            <EmptyState title="No ranked students yet" description="Upload a student list and run a processing job." />
          ) : (
            <ol className="divide-y divide-line">
              {top.data!.data.map((row) => (
                <li key={row.id}>
                  <Link to={`/students/${row.id}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-surface-muted">
                    <span className="tabular w-5 text-sm font-semibold text-ink-subtle">{row.rank}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{row.name}</span>
                      <span className="block truncate text-xs text-ink-muted">
                        {[row.branch, row.batch].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className="tabular text-right">
                      <span className="block text-sm font-semibold text-ink">{decimal(row.cpScore, 0)}</span>
                      <span className="block text-2xs text-ink-subtle">{num(row.totalSolved)} solved</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </Card>

        {/* Difficulty */}
        <Card>
          <CardHeader title="Difficulty distribution" subtitle="Across every platform that publishes one" />
          <div className="p-5">
            {difficulty.isLoading ? (
              <LoadingBlock rows={2} />
            ) : (
              <CompositionBar
                segments={[
                  { label: 'Easy', value: difficulty.data?.difficulty.easy ?? 0, color: difficultyColor('EASY', mode) },
                  { label: 'Medium', value: difficulty.data?.difficulty.medium ?? 0, color: difficultyColor('MEDIUM', mode) },
                  { label: 'Hard', value: difficulty.data?.difficulty.hard ?? 0, color: difficultyColor('HARD', mode) },
                  { label: 'Unclassified', value: difficulty.data?.difficulty.unclassified ?? 0, color: difficultyColor('UNCLASSIFIED', mode) },
                ]}
              />
            )}
            <p className="mt-3 text-2xs text-ink-subtle">
              “Unclassified” means the platform published a solved total but no Easy/Medium/Hard split — it is not a zero.
            </p>
          </div>
        </Card>

        {/* Topics */}
        <Card className="xl:col-span-2">
          <CardHeader
            title="Strongest topics"
            subtitle="Unified across platforms"
            actions={<Link to="/analytics" className="text-xs font-medium text-brand hover:underline">All topics</Link>}
          />
          <div className="p-5">
            {topics.isLoading ? (
              <LoadingBlock rows={5} />
            ) : (
              <CategoryBars
                data={(topics.data?.topics ?? []).slice(0, 10).map((topic) => ({
                  label: topic.topic,
                  value: topic.problemsSolved,
                }))}
              />
            )}
          </div>
        </Card>

        {/* Growth */}
        <Card className="xl:col-span-3">
          <CardHeader title="Cohort growth" subtitle="Average problems solved and CP score over the last 90 days" />
          <div className="p-5">
            {growth.isLoading ? (
              <LoadingBlock rows={4} />
            ) : (
              <div className="grid gap-6 lg:grid-cols-2">
                <div>
                  <p className="mb-2 text-xs font-medium text-ink-muted">Average problems solved</p>
                  <MultiLineChart
                    height={220}
                    series={[
                      {
                        key: 'solved',
                        label: 'Average solved',
                        color: 'rgb(37 99 235)',
                        points: (growth.data ?? []).map((point) => ({ x: point.date, y: point.averageSolved })),
                      },
                    ]}
                    xLabelFormatter={(value) => String(value).slice(5)}
                  />
                </div>
                <div>
                  <p className="mb-2 text-xs font-medium text-ink-muted">Average CP score</p>
                  <MultiLineChart
                    height={220}
                    series={[
                      {
                        key: 'score',
                        label: 'Average CP score',
                        color: 'rgb(22 163 74)',
                        points: (growth.data ?? []).map((point) => ({ x: point.date, y: point.averageScore })),
                      },
                    ]}
                    xLabelFormatter={(value) => String(value).slice(5)}
                  />
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Recent jobs */}
        <Card className="xl:col-span-3">
          <CardHeader
            title="Recent processing jobs"
            actions={<Link to="/jobs" className="text-xs font-medium text-brand hover:underline">All jobs</Link>}
          />
          {overview.isLoading ? (
            <LoadingBlock rows={3} />
          ) : (data?.recentJobs.length ?? 0) === 0 ? (
            <EmptyState
              title="No jobs yet"
              description="Upload a student list to fetch platform data."
              icon={<AlertTriangle className="h-8 w-8" />}
              action={<Link to="/upload" className="btn-primary">Upload Excel</Link>}
            />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Job</th><th>Type</th><th>Status</th><th>Progress</th>
                    <th className="text-right">Successful</th><th className="text-right">Failed</th>
                    <th className="text-right">Rate limited</th><th>Started</th>
                  </tr>
                </thead>
                <tbody>
                  {data!.recentJobs.map((job) => (
                    <tr key={job.id}>
                      <td>
                        <Link to={`/jobs/${job.id}`} className="font-medium text-brand hover:underline">#{job.number}</Link>
                      </td>
                      <td className="text-ink-muted">{JOB_TYPE_LABELS[job.type] ?? job.type}</td>
                      <td>
                        <span className={`badge ${JOB_STATUS_TONE[job.status] ?? ''}`}>{job.status.replaceAll('_', ' ')}</span>
                      </td>
                      <td className="w-40">
                        <ProgressBar value={job.processed} max={Math.max(1, job.totalItems)} showLabel />
                      </td>
                      <td className="tabular text-right text-positive">{num(job.successful)}</td>
                      <td className="tabular text-right text-negative">{num(job.failed)}</td>
                      <td className="tabular text-right text-caution">{num(job.rateLimited)}</td>
                      <td className="whitespace-nowrap text-xs text-ink-muted">{relativeTime(job.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
