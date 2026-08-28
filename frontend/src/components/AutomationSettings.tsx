import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { CalendarClock, PlayCircle, RotateCcw, Save } from 'lucide-react';
import { alertsApi, scheduleApi, settingsApi } from '../api/endpoints';
import { errorMessage } from '../api/client';
import { Callout, Card, CardHeader, EmptyState, LoadingBlock, Spinner, useToast } from './ui';
import { formatDateTime, relativeTime } from '../lib/format';
import type { AlertRules, RefreshSchedule, SettingsResponse } from '../types/api';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Zones an Indian institution is most likely to want, plus a free-text escape. */
const COMMON_ZONES = ['Asia/Kolkata', 'UTC', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'America/New_York'];

const RUN_STATUS_TONE: Record<string, string> = {
  COMPLETED: 'bg-positive/10 text-positive',
  STARTED: 'bg-brand/10 text-brand',
  CLAIMED: 'bg-ink-subtle/15 text-ink-muted',
  SKIPPED: 'bg-caution/10 text-caution',
  FAILED: 'bg-negative/10 text-negative',
};

export function AutomationSettings({ settings, editable }: { settings: SettingsResponse; editable: boolean }) {
  const { notify } = useToast();
  const queryClient = useQueryClient();

  const [schedule, setSchedule] = useState<RefreshSchedule>(settings.data['processing.schedule']);
  const [rules, setRules] = useState<AlertRules>(settings.data['alerts.rules']);
  useEffect(() => setSchedule(settings.data['processing.schedule']), [settings]);
  useEffect(() => setRules(settings.data['alerts.rules']), [settings]);

  const status = useQuery({ queryKey: ['schedule-status'], queryFn: scheduleApi.status, refetchInterval: 30_000 });

  const saveSchedule = useMutation({
    mutationFn: (value: RefreshSchedule) => settingsApi.update('processing.schedule', value as never),
    onSuccess: () => {
      notify('Schedule saved.', 'success');
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      queryClient.invalidateQueries({ queryKey: ['schedule-status'] });
    },
    onError: (error) => notify(errorMessage(error), 'error'),
  });

  const saveRules = useMutation({
    mutationFn: (value: AlertRules) => settingsApi.update('alerts.rules', value as never, true),
    onSuccess: (result) => {
      notify(
        result.realerted !== undefined ? `Rules saved. Re-evaluated ${result.realerted} students.` : 'Rules saved.',
        'success',
      );
      queryClient.invalidateQueries();
    },
    onError: (error) => notify(errorMessage(error), 'error'),
  });

  const resetRules = useMutation({
    mutationFn: () => settingsApi.reset('alerts.rules'),
    onSuccess: () => {
      notify('Alert rules reset to defaults.', 'success');
      queryClient.invalidateQueries();
    },
    onError: (error) => notify(errorMessage(error), 'error'),
  });

  const runNow = useMutation({
    mutationFn: scheduleApi.runNow,
    onSuccess: (result) => {
      notify(result.ran ? `Started job #${result.jobNumber}.` : (result.reason ?? 'Nothing was due.'), result.ran ? 'success' : 'info');
      queryClient.invalidateQueries({ queryKey: ['schedule-status'] });
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (error) => notify(errorMessage(error), 'error'),
  });

  const recomputeAlerts = useMutation({
    mutationFn: alertsApi.recompute,
    onSuccess: (result) => {
      notify(result.message, 'success');
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
    },
    onError: (error) => notify(errorMessage(error), 'error'),
  });

  return (
    <div className="space-y-8">
      {/* ---------------------------------------------------------------- */}
      <section>
        <h3 className="text-sm font-semibold text-ink">Automatic refresh</h3>
        <p className="mb-4 mt-0.5 text-xs text-ink-muted">
          Growth charts and the inactivity rules only work when data keeps arriving. Without a schedule they depend on
          somebody remembering to press Refresh.
        </p>

        <label className="mb-4 flex items-center gap-2.5">
          <input
            type="checkbox"
            checked={schedule.enabled}
            disabled={!editable}
            onChange={(event) => setSchedule({ ...schedule, enabled: event.target.checked })}
          />
          <span className="text-sm font-medium text-ink">Refresh every profile on a schedule</span>
        </label>

        <div className={clsx('grid gap-4 sm:grid-cols-2 lg:grid-cols-4', !schedule.enabled && 'opacity-50')}>
          <label className="block">
            <span className="label">How often</span>
            <select
              className="input"
              value={schedule.frequency}
              disabled={!editable || !schedule.enabled}
              onChange={(event) => setSchedule({ ...schedule, frequency: event.target.value as 'daily' | 'weekly' })}
            >
              <option value="daily">Every day</option>
              <option value="weekly">Every week</option>
            </select>
          </label>

          {schedule.frequency === 'weekly' && (
            <label className="block">
              <span className="label">Day</span>
              <select
                className="input"
                value={schedule.dayOfWeek}
                disabled={!editable || !schedule.enabled}
                onChange={(event) => setSchedule({ ...schedule, dayOfWeek: Number(event.target.value) })}
              >
                {DAYS.map((day, index) => (
                  <option key={day} value={index}>{day}</option>
                ))}
              </select>
            </label>
          )}

          <label className="block">
            <span className="label">Time</span>
            <input
              type="time"
              className="input"
              value={`${String(schedule.hour).padStart(2, '0')}:${String(schedule.minute).padStart(2, '0')}`}
              disabled={!editable || !schedule.enabled}
              onChange={(event) => {
                const [hour, minute] = event.target.value.split(':').map(Number);
                setSchedule({ ...schedule, hour: hour ?? 2, minute: minute ?? 0 });
              }}
            />
          </label>

          <label className="block">
            <span className="label">Time zone</span>
            <input
              className="input"
              list="tcp-timezones"
              value={schedule.timezone}
              disabled={!editable || !schedule.enabled}
              onChange={(event) => setSchedule({ ...schedule, timezone: event.target.value })}
            />
            <datalist id="tcp-timezones">
              {COMMON_ZONES.map((zone) => <option key={zone} value={zone} />)}
            </datalist>
            <span className="mt-1 block text-2xs text-ink-subtle">The time above means this zone, not the server's.</span>
          </label>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="flex items-start gap-2.5">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={schedule.force}
              disabled={!editable || !schedule.enabled}
              onChange={(event) => setSchedule({ ...schedule, force: event.target.checked })}
            />
            <span className="text-sm text-ink">
              Ignore the cache window
              <span className="mt-0.5 block text-2xs text-ink-subtle">
                Re-fetches everything, even profiles read recently. Slower and harder on the platforms — leave off unless
                the cache duration is longer than the gap between runs.
              </span>
            </span>
          </label>

          <label className="block">
            <span className="label">Skip a run missed by more than</span>
            <span className="flex items-center gap-2">
              <input
                type="number"
                className="input"
                min={0}
                max={10080}
                value={schedule.graceMinutes}
                disabled={!editable || !schedule.enabled}
                onChange={(event) => setSchedule({ ...schedule, graceMinutes: Number(event.target.value) })}
              />
              <span className="shrink-0 text-xs text-ink-muted">minutes</span>
            </span>
            <span className="mt-1 block text-2xs text-ink-subtle">
              After a long outage a missed run is recorded and skipped rather than starting at an unexpected hour.
            </span>
          </label>
        </div>

        {editable && (
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="btn-primary" disabled={saveSchedule.isPending} onClick={() => saveSchedule.mutate(schedule)}>
              {saveSchedule.isPending ? <Spinner /> : <Save className="h-4 w-4" />}
              Save schedule
            </button>
            <button type="button" className="btn-secondary" disabled={runNow.isPending} onClick={() => runNow.mutate()}>
              {runNow.isPending ? <Spinner /> : <PlayCircle className="h-4 w-4" />}
              Refresh everyone now
            </button>
          </div>
        )}

        <div className="mt-5">
          {status.isLoading ? (
            <LoadingBlock rows={2} />
          ) : (
            <Card>
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    <CalendarClock className="h-4 w-4 text-ink-muted" />
                    {status.data?.description}
                  </span>
                }
                subtitle={
                  status.data?.nextRunAt
                    ? `Next run ${formatDateTime(status.data.nextRunAt)} (${relativeTime(status.data.nextRunAt).replace(' ago', ' from now')})`
                    : 'No run scheduled'
                }
              />
              {(status.data?.recentRuns.length ?? 0) === 0 ? (
                <EmptyState title="No scheduled runs yet" description="Once the schedule fires, each occurrence is recorded here." />
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr><th>Ran at</th><th>Started by</th><th>Status</th><th>Job</th><th>Detail</th><th>Finished</th></tr>
                    </thead>
                    <tbody>
                      {status.data!.recentRuns.map((run) => (
                        <tr key={run.id}>
                          <td className="whitespace-nowrap text-xs">{formatDateTime(run.scheduledFor)}</td>
                          <td className="whitespace-nowrap text-xs text-ink-muted">
                            {run.trigger === 'MANUAL' ? 'Manual' : 'Schedule'}
                          </td>
                          <td><span className={`badge ${RUN_STATUS_TONE[run.status] ?? ''}`}>{run.status}</span></td>
                          <td className="text-xs">
                            {run.jobId ? (
                              <Link to={`/jobs/${run.jobId}`} className="text-brand hover:underline">#{run.jobNumber}</Link>
                            ) : '—'}
                          </td>
                          <td className="max-w-md truncate text-xs text-ink-muted" title={run.note ?? ''}>{run.note ?? '—'}</td>
                          <td className="whitespace-nowrap text-xs text-ink-muted">{run.finishedAt ? relativeTime(run.finishedAt) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="border-t border-line pt-6">
        <h3 className="text-sm font-semibold text-ink">Needs-attention rules</h3>
        <p className="mb-4 mt-0.5 text-xs text-ink-muted">
          Thresholds for the{' '}
          <Link to="/alerts" className="font-medium text-brand hover:underline">needs-attention list</Link>. Every rule is
          measured against observed snapshots.
        </p>

        <label className="mb-4 flex items-center gap-2.5">
          <input
            type="checkbox"
            checked={rules.enabled}
            disabled={!editable}
            onChange={(event) => setRules({ ...rules, enabled: event.target.checked })}
          />
          <span className="text-sm font-medium text-ink">Flag students who need attention</span>
        </label>

        <div className={clsx('grid gap-4 sm:grid-cols-2 lg:grid-cols-3', !rules.enabled && 'opacity-50')}>
          <NumberField label="Judge activity over" suffix="days" value={rules.inactivityDays} disabled={!editable || !rules.enabled}
            hint="A student is compared against their own reading from this long ago."
            onChange={(v) => setRules({ ...rules, inactivityDays: v })} />
          <NumberField label="Progress at or below" suffix="solved" value={rules.minProgressSolved} disabled={!editable || !rules.enabled}
            hint="Counts as stalled over that window."
            onChange={(v) => setRules({ ...rules, minProgressSolved: v })} />
          <NumberField label="Rating drop of at least" suffix="points" value={rules.ratingDropThreshold} disabled={!editable || !rules.enabled}
            hint="Measured from the peak since the window opened, not an all-time high."
            onChange={(v) => setRules({ ...rules, ratingDropThreshold: v })} />
          <NumberField label="No contest for" suffix="days" value={rules.contestInactivityDays} disabled={!editable || !rules.enabled}
            onChange={(v) => setRules({ ...rules, contestInactivityDays: v })} />
          <NumberField label="Data is too old after" suffix="days" value={rules.staleDataDays} disabled={!editable || !rules.enabled}
            hint="Past this, activity is unjudgeable and the alert points at the refresh, not the student."
            onChange={(v) => setRules({ ...rules, staleDataDays: v })} />
          <NumberField label="A failing handle is wrong after" suffix="days" value={rules.brokenProfileDays} disabled={!editable || !rules.enabled}
            onChange={(v) => setRules({ ...rules, brokenProfileDays: v })} />
        </div>

        <div className="mt-4">
          <Callout tone="info" title="A student is never blamed for a gap in our own data">
            If nothing has been fetched recently enough to judge activity, the concern raised is “data too old to judge”,
            which is an administrator’s job to fix — not evidence that the student stopped practising.
          </Callout>
        </div>

        {editable && (
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="btn-primary" disabled={saveRules.isPending} onClick={() => saveRules.mutate(rules)}>
              {saveRules.isPending ? <Spinner /> : <Save className="h-4 w-4" />}
              Save and re-evaluate
            </button>
            <button type="button" className="btn-secondary" disabled={recomputeAlerts.isPending} onClick={() => recomputeAlerts.mutate()}>
              {recomputeAlerts.isPending ? <Spinner /> : <RotateCcw className="h-4 w-4" />}
              Re-evaluate now
            </button>
            <button type="button" className="btn-ghost" onClick={() => resetRules.mutate()}>
              <RotateCcw className="h-4 w-4" />
              Reset
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function NumberField({
  label, value, onChange, disabled, suffix, hint,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  suffix?: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <span className="flex items-center gap-2">
        <input type="number" className="input" min={0} value={value} disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))} />
        {suffix && <span className="shrink-0 text-xs text-ink-muted">{suffix}</span>}
      </span>
      {hint && <span className="mt-1 block text-2xs text-ink-subtle">{hint}</span>}
    </label>
  );
}
