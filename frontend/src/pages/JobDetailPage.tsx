import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ban, Download, RotateCcw } from 'lucide-react';
import { jobsApi } from '../api/endpoints';
import { downloadFile, errorMessage } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import {
  Callout, Card, CardHeader, EmptyState, ErrorState, LoadingBlock, PageHeader, Pagination,
  ProgressBar, StatCard, StatusBadge, useToast,
} from '../components/ui';
import { JOB_STATUS_TONE, JOB_TYPE_LABELS, duration, formatDateTime, num, percent } from '../lib/format';

const ITEM_STATUSES = ['', 'FAILED', 'RATE_LIMITED', 'COMPLETED', 'PENDING', 'RUNNING', 'SKIPPED'];

export default function JobDetailPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);

  const job = useQuery({
    queryKey: ['job', id],
    queryFn: () => jobsApi.get(id),
    refetchInterval: (query) =>
      ['RUNNING', 'QUEUED'].includes(query.state.data?.status ?? '') ? 1500 : false,
  });

  const items = useQuery({
    queryKey: ['job-items', id, statusFilter, page],
    queryFn: () => jobsApi.items(id, { status: statusFilter || undefined, page, pageSize: 25 }),
    refetchInterval: ['RUNNING', 'QUEUED'].includes(job.data?.status ?? '') ? 3000 : false,
  });

  const retry = useMutation({
    mutationFn: () => jobsApi.retry(id),
    onSuccess: (result) => {
      notify(result.requeued > 0 ? `Re-queued ${result.requeued} profiles.` : 'Nothing left to retry.', result.requeued > 0 ? 'success' : 'info');
      queryClient.invalidateQueries({ queryKey: ['job', id] });
      queryClient.invalidateQueries({ queryKey: ['job-items', id] });
    },
    onError: (error) => notify(errorMessage(error), 'error'),
  });

  const cancel = useMutation({
    mutationFn: () => jobsApi.cancel(id),
    onSuccess: () => {
      notify('Job cancelled.', 'info');
      queryClient.invalidateQueries({ queryKey: ['job', id] });
    },
    onError: (error) => notify(errorMessage(error), 'error'),
  });

  if (job.isLoading) return <LoadingBlock rows={8} />;
  if (job.isError) return <ErrorState message={errorMessage(job.error)} onRetry={() => job.refetch()} />;

  const data = job.data!;
  const running = data.status === 'RUNNING' || data.status === 'QUEUED';
  const retryable = data.failed + data.rateLimited;

  return (
    <>
      <Link to="/jobs" className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted hover:text-ink">
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to processing
      </Link>

      <PageHeader
        title={`Processing job #${data.number}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span className={`badge ${JOB_STATUS_TONE[data.status] ?? ''}`}>{data.status.replaceAll('_', ' ')}</span>
            <span>{JOB_TYPE_LABELS[data.type] ?? data.type}</span>
            <span>· started {formatDateTime(data.startedAt)}</span>
            {data.finishedAt && <span>· finished {formatDateTime(data.finishedAt)}</span>}
          </span>
        }
        actions={
          <>
            {can('TRAINER') && retryable > 0 && (
              <button type="button" className="btn-secondary" disabled={retry.isPending} onClick={() => retry.mutate()}>
                <RotateCcw className={`h-4 w-4 ${retry.isPending ? 'animate-spin' : ''}`} />
                Retry {retryable} failed
              </button>
            )}
            {can('TRAINER') && running && (
              <button type="button" className="btn-danger" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
                <Ban className="h-4 w-4" />
                Cancel
              </button>
            )}
            <button
              type="button"
              className="btn-secondary"
              onClick={() => downloadFile(`/api/reports/failures?format=xlsx&jobId=${id}`, `job-${data.number}-failures.xlsx`).catch((e) => notify(errorMessage(e), 'error'))}
            >
              <Download className="h-4 w-4" />
              Export failures
            </button>
          </>
        }
      />

      <Card className="mb-5 p-5">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <p className="text-sm font-medium text-ink">
            {num(data.studentsProcessed)} / {num(data.totalStudents)} students processed
          </p>
          <p className="tabular text-sm font-semibold text-ink">{percent(data.percentage)}</p>
        </div>
        <ProgressBar value={data.processed} max={Math.max(1, data.totalItems)} />
        <p className="mt-2 text-xs text-ink-muted">
          {num(data.processed)} of {num(data.totalItems)} profile fetches complete
          {data.currentStudent && running && <> · currently fetching <span className="font-medium text-ink">{data.currentStudent}</span></>}
        </p>
      </Card>

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Total students" value={num(data.totalStudents)} />
        <StatCard label="Successful" value={num(data.successful)} accent="rgb(var(--positive))" />
        <StatCard label="Failed" value={num(data.failed)} accent={data.failed > 0 ? 'rgb(var(--negative))' : undefined} />
        <StatCard label="Rate limited" value={num(data.rateLimited)} accent={data.rateLimited > 0 ? 'rgb(var(--caution))' : undefined} />
        <StatCard label="Pending" value={num(data.pending)} />
      </div>

      {data.error && (
        <div className="mb-5"><Callout tone="danger" title="Job error">{data.error}</Callout></div>
      )}

      <Card className="mb-5">
        <CardHeader title="Platform status" subtitle="Per-platform outcome for this job" />
        <div className="divide-y divide-line">
          {data.platformStatus.map((platform) => (
            <div key={platform.platform} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <span className="flex min-w-[7.5rem] items-center gap-2 text-sm font-medium text-ink">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: platform.color }} aria-hidden />
                {platform.label}
              </span>
              <div className="min-w-[10rem] flex-1">
                <ProgressBar value={platform.successful} max={Math.max(1, platform.total)} color={platform.color} />
              </div>
              <span className="tabular w-32 text-right text-xs text-ink-muted">
                {num(platform.successful)} / {num(platform.total)} successful
              </span>
              <span className="flex gap-2 text-2xs">
                {platform.failed > 0 && <span className="text-negative">{platform.failed} failed</span>}
                {platform.rateLimited > 0 && <span className="text-caution">{platform.rateLimited} limited</span>}
                {platform.pending > 0 && <span className="text-ink-subtle">{platform.pending} pending</span>}
              </span>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Profile fetches"
          subtitle="Every student × platform attempt, with the exact reason for each failure"
          actions={
            <select
              className="input py-1.5 text-xs"
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value);
                setPage(1);
              }}
            >
              {ITEM_STATUSES.map((status) => (
                <option key={status} value={status}>{status === '' ? 'All statuses' : status.replaceAll('_', ' ')}</option>
              ))}
            </select>
          }
        />
        {items.isLoading ? (
          <LoadingBlock rows={6} />
        ) : (items.data?.data.length ?? 0) === 0 ? (
          <EmptyState title="No matching fetches" description="Try a different status filter." />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Student</th><th>Platform</th><th>Result</th>
                    <th className="text-right">Attempts</th><th>Error</th>
                    <th className="text-right">Duration</th><th>Last attempt</th>
                  </tr>
                </thead>
                <tbody>
                  {items.data!.data.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <Link to={`/students/${item.student.id}`} className="hover:text-brand">{item.student.name}</Link>
                        <span className="block text-xs text-ink-muted">{item.student.studentId}</span>
                      </td>
                      <td className="text-xs text-ink-muted">{item.platformLabel}</td>
                      <td>{item.dataStatus ? <StatusBadge status={item.dataStatus} /> : <span className="badge bg-ink-subtle/15 text-ink-muted">{item.status}</span>}</td>
                      <td className="tabular text-right">{item.attempts}</td>
                      <td className="max-w-md truncate text-xs text-ink-muted" title={item.error ?? ''}>{item.error ?? '—'}</td>
                      <td className="tabular text-right text-xs text-ink-muted">{duration(item.durationMs)}</td>
                      <td className="whitespace-nowrap text-xs text-ink-muted">{formatDateTime(item.lastAttempt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={items.data!.pagination.page}
              totalPages={items.data!.pagination.totalPages}
              total={items.data!.pagination.total}
              pageSize={items.data!.pagination.pageSize}
              onChange={setPage}
            />
          </>
        )}
      </Card>
    </>
  );
}
