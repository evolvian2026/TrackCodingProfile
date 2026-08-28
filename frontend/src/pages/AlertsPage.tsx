import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { BellOff, Check, RefreshCw, ShieldAlert } from 'lucide-react';
import { alertsApi } from '../api/endpoints';
import { errorMessage } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { useFilters } from '../hooks/useFilters';
import { FilterBar } from '../components/FilterBar';
import {
  Callout, Card, CardHeader, EmptyState, ErrorState, LoadingBlock, PageHeader, Pagination, useToast,
} from '../components/ui';
import { PLATFORM_LABELS, formatDate, num, relativeTime } from '../lib/format';
import type { AlertSeverity, AlertType, Platform, StudentAlert } from '../types/api';

const SEVERITY_TONE: Record<AlertSeverity, string> = {
  CRITICAL: 'bg-negative/10 text-negative',
  WARNING: 'bg-caution/10 text-caution',
  INFO: 'bg-brand/10 text-brand',
};

/**
 * STALE_DATA is deliberately singled out: it means the application has not
 * refreshed recently enough to judge the student at all. It is the operator's
 * problem, and mixing it in with the student-behaviour alerts would quietly
 * blame someone for a gap in our own data collection.
 */
const OPERATOR_ALERTS = new Set<AlertType>(['STALE_DATA', 'PROFILE_UNAVAILABLE', 'NO_PLATFORM_HANDLES']);

/**
 * Turns an alert's stored evidence into the dated observations the rule
 * actually compared.
 *
 * The point is that a trainer can check the claim instead of trusting it:
 * "inactive" is not something anyone can argue with, but "1 solved on 7 Aug,
 * still 1 on 28 Aug" is. Anything we cannot describe precisely renders nothing
 * rather than a guess.
 */
function describeEvidence(alert: StudentAlert): string | null {
  const e = alert.evidence as Record<string, any> | null;
  if (!e) return null;

  if (e.from && e.to) {
    return `${num(e.from.totalSolved)} solved on ${formatDate(e.from.date)} · ${num(e.to.totalSolved)} on ${formatDate(e.to.date)}`;
  }
  if (e.peak && e.current) {
    return `peak ${num(e.peak.rating)} on ${formatDate(e.peak.date)} · ${num(e.current.rating)} on ${formatDate(e.current.date)}`;
  }
  if (e.since) {
    return `${num(e.contestsAttended)} contests as of ${formatDate(e.since)}, unchanged since`;
  }
  if (e.lastSuccessAt) return `last successful fetch ${formatDate(e.lastSuccessAt)}`;
  if (Array.isArray(e.profiles)) {
    return e.profiles
      .map((p: any) => `${PLATFORM_LABELS[p.platform as Platform] ?? p.platform}: ${p.lastSuccessAt ? `last worked ${formatDate(p.lastSuccessAt)}` : 'never returned data'}`)
      .join(' · ');
  }
  return null;
}

export default function AlertsPage() {
  const { params } = useFilters();
  const { can } = useAuth();
  const { notify } = useToast();
  const queryClient = useQueryClient();

  const [type, setType] = useState<string>('');
  const [includeAcknowledged, setIncludeAcknowledged] = useState(false);
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: ['alerts', params, type, includeAcknowledged, page],
    queryFn: () =>
      alertsApi.list({ ...params, type: type || undefined, includeAcknowledged, page, pageSize: 50 }),
  });

  const acknowledge = useMutation({
    mutationFn: ({ id, acknowledged }: { id: string; acknowledged: boolean }) => alertsApi.acknowledge(id, acknowledged),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['alerts'] }),
    onError: (error) => notify(errorMessage(error), 'error'),
  });

  const recompute = useMutation({
    mutationFn: alertsApi.recompute,
    onSuccess: (result) => {
      notify(result.message, 'success');
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
    },
    onError: (error) => notify(errorMessage(error), 'error'),
  });

  const summary = query.data?.summary;
  const alerts = query.data?.data ?? [];
  const operatorCount = summary?.byType.filter((t) => OPERATOR_ALERTS.has(t.type)).reduce((n, t) => n + t.count, 0) ?? 0;

  return (
    <>
      <PageHeader
        title="Needs attention"
        subtitle="Students whose practice has stalled or declined, and profiles the application cannot read."
        actions={
          can('TRAINER') && (
            <button type="button" className="btn-secondary" disabled={recompute.isPending} onClick={() => recompute.mutate()}>
              <RefreshCw className={`h-4 w-4 ${recompute.isPending ? 'animate-spin' : ''}`} />
              Re-evaluate
            </button>
          )
        }
      />

      <FilterBar show={['college', 'batch', 'branch', 'section']}>
        <label className="flex flex-col">
          <span className="mb-1 text-2xs font-medium uppercase tracking-wide text-ink-subtle">Concern</span>
          <select
            className="input py-1.5 text-xs"
            value={type}
            onChange={(event) => {
              setType(event.target.value);
              setPage(1);
            }}
          >
            <option value="">All concerns</option>
            {(summary?.byType ?? []).map((entry) => (
              <option key={entry.type} value={entry.type}>
                {entry.label} ({entry.count})
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 pb-2 text-xs text-ink-muted">
          <input
            type="checkbox"
            checked={includeAcknowledged}
            onChange={(event) => {
              setIncludeAcknowledged(event.target.checked);
              setPage(1);
            }}
          />
          Show acknowledged
        </label>
      </FilterBar>

      {summary && (
        <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <SummaryTile label="Open concerns" value={num(summary.unacknowledged)} tone={summary.unacknowledged > 0 ? 'caution' : 'positive'} />
          <SummaryTile label="Needs coaching" value={num(summary.total - operatorCount)} hint="Stalled, declining or inactive" />
          <SummaryTile label="Needs data fixing" value={num(operatorCount)} hint="Wrong handles or stale fetches" />
          <SummaryTile label="Warnings" value={num(summary.bySeverity.WARNING + summary.bySeverity.CRITICAL)} />
        </div>
      )}

      {summary && summary.byType.some((t) => t.type === 'STALE_DATA') && (
        <div className="mb-5">
          <Callout tone="warning" title="Some students cannot be judged right now">
            Their data is too old to tell whether they are practising. That is a collection gap, not a student problem —
            run a refresh, or turn on{' '}
            <Link to="/settings" className="font-medium text-brand underline-offset-2 hover:underline">
              automatic refresh
            </Link>{' '}
            so it never falls behind again.
          </Callout>
        </div>
      )}

      <Card>
        <CardHeader
          title="Concerns"
          subtitle={query.data ? `${num(query.data.pagination.total)} matching the current filters` : undefined}
        />
        {query.isLoading ? (
          <LoadingBlock rows={8} />
        ) : query.isError ? (
          <ErrorState message={errorMessage(query.error)} onRetry={() => query.refetch()} />
        ) : alerts.length === 0 ? (
          <EmptyState
            icon={<ShieldAlert className="h-8 w-8" />}
            title="Nobody needs attention"
            description="No student matched a rule. If the data is stale this can also mean there is not enough recent history to judge — check the Automation settings."
          />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {alerts.map((alert) => (
                <AlertRow
                  key={alert.id}
                  alert={alert}
                  canAcknowledge={can('TRAINER')}
                  onAcknowledge={(acknowledged) => acknowledge.mutate({ id: alert.id, acknowledged })}
                />
              ))}
            </ul>
            <Pagination
              page={query.data!.pagination.page}
              totalPages={query.data!.pagination.totalPages}
              total={query.data!.pagination.total}
              pageSize={query.data!.pagination.pageSize}
              onChange={setPage}
            />
          </>
        )}
      </Card>
    </>
  );
}

function SummaryTile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'caution' | 'positive' }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</p>
      <p
        className={clsx(
          'tabular mt-1.5 text-2xl font-semibold',
          tone === 'caution' && 'text-caution',
          tone === 'positive' && 'text-positive',
          !tone && 'text-ink',
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-2xs text-ink-subtle">{hint}</p>}
    </div>
  );
}

function AlertRow({
  alert,
  canAcknowledge,
  onAcknowledge,
}: {
  alert: StudentAlert;
  canAcknowledge: boolean;
  onAcknowledge: (acknowledged: boolean) => void;
}) {
  const student = alert.student;
  const evidence = describeEvidence(alert);

  return (
    <li className={clsx('flex flex-wrap items-start gap-3 px-5 py-3.5', alert.acknowledgedAt && 'opacity-60')}>
      <span className={clsx('badge mt-0.5 shrink-0', SEVERITY_TONE[alert.severity])}>{alert.label}</span>

      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <Link to={`/students/${student.id}`} className="text-sm font-medium text-ink hover:text-brand">
            {student.name}
          </Link>
          <span className="text-xs text-ink-muted">
            {[student.studentId, student.branch, student.batch, student.college].filter(Boolean).join(' · ')}
          </span>
        </p>
        <p className="mt-0.5 text-sm text-ink-muted">{alert.message}</p>
        {evidence && <p className="tabular mt-0.5 text-2xs text-ink-subtle">Based on {evidence}</p>}
        <p className="mt-1 text-2xs text-ink-subtle">
          Detected {relativeTime(alert.detectedAt)}
          {alert.acknowledgedAt && ` · acknowledged by ${alert.acknowledgedBy ?? 'someone'} ${relativeTime(alert.acknowledgedAt)}`}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {student.analytics?.hasData && (
          <span className="tabular hidden text-right text-xs text-ink-muted sm:block">
            <span className="block">{num(student.analytics.totalSolved)} solved</span>
            <span className="block text-2xs text-ink-subtle">score {student.analytics.cpScore.toFixed(0)}</span>
          </span>
        )}
        {canAcknowledge && (
          <button
            type="button"
            className="btn-ghost px-2 py-1 text-xs"
            title={alert.acknowledgedAt ? 'Move back to the open list' : 'Acknowledge — hides it from the default view'}
            onClick={() => onAcknowledge(!alert.acknowledgedAt)}
          >
            {alert.acknowledgedAt ? <BellOff className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
            {alert.acknowledgedAt ? 'Reopen' : 'Acknowledge'}
          </button>
        )}
      </div>
    </li>
  );
}
