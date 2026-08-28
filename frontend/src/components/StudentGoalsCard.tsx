import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { Target } from 'lucide-react';
import { goalsApi } from '../api/endpoints';
import { Card, CardHeader, ProgressBar } from './ui';
import { decimal, formatDate, num } from '../lib/format';
import type { TargetOutcome } from '../types/api';

const OUTCOME_TONE: Record<TargetOutcome, string> = {
  MET: 'bg-positive/10 text-positive',
  BEHIND: 'bg-caution/10 text-caution',
  // Unmeasurable is not a failure state, so it does not get a failure colour.
  UNKNOWN: 'bg-surface-muted text-ink-muted',
  NO_DATA: 'bg-surface-muted text-ink-muted',
};

const OUTCOME_LABEL: Record<TargetOutcome, string> = {
  MET: 'Met',
  BEHIND: 'Short',
  UNKNOWN: 'Not measurable',
  NO_DATA: 'No data',
};

/** The goals covering one student, and where they stand against each target. */
export function StudentGoalsCard({ studentId }: { studentId: string }) {
  const query = useQuery({ queryKey: ['student-goals', studentId], queryFn: () => goalsApi.forStudent(studentId) });
  const goals = query.data ?? [];

  if (query.isLoading || goals.length === 0) return null;

  return (
    <Card className="mb-5">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Target className="h-4 w-4 text-ink-muted" />
            Goals
          </span>
        }
        subtitle="Targets set for this student's cohort."
        actions={
          <Link to="/goals" className="text-xs font-medium text-brand hover:underline">
            Manage goals
          </Link>
        }
      />

      <div className="space-y-4 px-5 py-4">
        {goals.map((goal) => (
          <div key={goal.id}>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="text-sm font-medium text-ink">
                {goal.name} <span className="text-xs font-normal text-ink-muted">· {goal.scope}</span>
              </p>
              <p className={clsx('text-xs', goal.daysLeft < 0 ? 'text-negative' : goal.daysLeft <= 14 ? 'text-caution' : 'text-ink-muted')}>
                {goal.daysLeft < 0 ? `Overdue by ${Math.abs(goal.daysLeft)} days` : `${goal.daysLeft} days left`} · due{' '}
                {formatDate(goal.dueOn)}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {goal.targets.map((t) => (
                <div key={t.metric} className="rounded-lg border border-line px-3 py-2">
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <span className="truncate text-xs text-ink">{t.label}</span>
                    <span className={clsx('badge shrink-0', OUTCOME_TONE[t.outcome])}>{OUTCOME_LABEL[t.outcome]}</span>
                  </div>

                  <p className="tabular text-sm text-ink">
                    {t.value === null ? <span className="text-ink-subtle">N/A</span> : num(t.value)}
                    <span className="text-ink-muted"> / {num(t.target)}</span>
                  </p>

                  {t.value !== null && <ProgressBar className="mt-1.5" value={t.value} max={Math.max(t.target, t.value)} />}

                  {t.outcome === 'BEHIND' && t.requiredPerWeek !== null && (
                    <p className="mt-1 text-2xs text-ink-subtle">
                      Needs {decimal(t.requiredPerWeek, 1)}/week
                      {t.observedGain !== null && t.observedOverDays !== null && (
                        <> · gained {num(t.observedGain)} in the last {num(t.observedOverDays)} days</>
                      )}
                    </p>
                  )}

                  {t.outcome === 'UNKNOWN' && (
                    <p className="mt-1 text-2xs text-ink-subtle">
                      No linked platform publishes this. Not counted against them.
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
