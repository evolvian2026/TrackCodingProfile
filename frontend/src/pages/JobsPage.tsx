import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Download } from 'lucide-react';
import { jobsApi } from '../api/endpoints';
import { downloadFile, errorMessage } from '../api/client';
import { Card, CardHeader, EmptyState, ErrorState, LoadingBlock, PageHeader, Pagination, ProgressBar, StatCard, useToast } from '../components/ui';
import { JOB_STATUS_TONE, JOB_TYPE_LABELS, num, relativeTime } from '../lib/format';

export default function JobsPage() {
  const [page, setPage] = useState(1);
  const { notify } = useToast();

  const jobs = useQuery({
    queryKey: ['jobs', page],
    queryFn: () => jobsApi.list({ page, pageSize: 20 }),
    // Poll while anything is in flight so progress is live.
    refetchInterval: (query) =>
      (query.state.data?.data ?? []).some((job) => job.status === 'RUNNING' || job.status === 'QUEUED') ? 2000 : false,
  });

  const queue = useQuery({ queryKey: ['queue-status'], queryFn: jobsApi.queueStatus, refetchInterval: 5000 });
  const errors = useQuery({ queryKey: ['recent-errors'], queryFn: () => jobsApi.errors({ pageSize: 15 }) });

  return (
    <>
      <PageHeader
        title="Processing"
        subtitle="Background jobs that fetch public profile data from the coding platforms."
        actions={
          <button
            type="button"
            className="btn-secondary"
            onClick={() => downloadFile('/api/reports/failures?format=xlsx', 'failed-profiles.xlsx').catch((e) => notify(errorMessage(e), 'error'))}
          >
            <Download className="h-4 w-4" />
            Export failures
          </button>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Queue driver" value={queue.data?.driver ?? '—'} hint={queue.data?.driver === 'inline' ? 'In-process queue' : 'Redis / BullMQ'} />
        <StatCard label="Waiting" value={num(queue.data?.waiting)} />
        <StatCard label="Active" value={num(queue.data?.active)} />
        <StatCard label="Recent failures" value={num(errors.data?.pagination.total)} />
      </div>

      <Card className="mb-5">
        <CardHeader title="Jobs" />
        {jobs.isLoading ? (
          <LoadingBlock rows={6} />
        ) : jobs.isError ? (
          <ErrorState message={errorMessage(jobs.error)} onRetry={() => jobs.refetch()} />
        ) : (jobs.data?.data.length ?? 0) === 0 ? (
          <EmptyState title="No processing jobs yet" description="Jobs are created when you import students or refresh profiles." action={<Link to="/upload" className="btn-primary">Upload students</Link>} />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Job</th><th>Type</th><th>Status</th><th className="w-48">Progress</th>
                    <th className="text-right">OK</th><th className="text-right">Failed</th>
                    <th className="text-right">Limited</th><th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.data!.data.map((job) => (
                    <tr key={job.id}>
                      <td><Link to={`/jobs/${job.id}`} className="font-medium text-brand hover:underline">#{job.number}</Link></td>
                      <td className="text-xs text-ink-muted">{JOB_TYPE_LABELS[job.type] ?? job.type}</td>
                      <td><span className={`badge ${JOB_STATUS_TONE[job.status] ?? ''}`}>{job.status.replaceAll('_', ' ')}</span></td>
                      <td>
                        <ProgressBar value={job.processed} max={Math.max(1, job.totalItems)} showLabel />
                        <span className="tabular mt-0.5 block text-2xs text-ink-subtle">
                          {num(job.processed)} / {num(job.totalItems)} profiles
                        </span>
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
            <Pagination
              page={jobs.data!.pagination.page}
              totalPages={jobs.data!.pagination.totalPages}
              total={jobs.data!.pagination.total}
              pageSize={jobs.data!.pagination.pageSize}
              onChange={setPage}
            />
          </>
        )}
      </Card>

      <Card>
        <CardHeader title="Recent platform errors" subtitle="Every failure is recorded with the reason it happened" />
        {errors.isLoading ? (
          <LoadingBlock rows={5} />
        ) : (errors.data?.data.length ?? 0) === 0 ? (
          <EmptyState title="No errors recorded" description="Every profile fetch has succeeded so far." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Student</th><th>Platform</th><th>Status</th><th>Message</th><th>Job</th><th>When</th></tr>
              </thead>
              <tbody>
                {errors.data!.data.map((error) => (
                  <tr key={error.id}>
                    <td>
                      {error.student ? (
                        <Link to={`/students/${error.student.id}`} className="hover:text-brand">{error.student.name}</Link>
                      ) : '—'}
                    </td>
                    <td className="text-xs text-ink-muted">{error.platform}</td>
                    <td><span className="badge bg-negative/10 text-negative">{error.status}</span></td>
                    <td className="max-w-md truncate text-xs" title={error.message}>{error.message}</td>
                    <td className="text-xs text-ink-muted">{error.job ? `#${error.job.number}` : '—'}</td>
                    <td className="whitespace-nowrap text-xs text-ink-muted">{relativeTime(error.occurredAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
