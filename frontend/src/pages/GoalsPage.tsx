import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { CalendarClock, Pencil, Plus, Target, Trash2, Users } from 'lucide-react';
import { goalsApi } from '../api/endpoints';
import { errorMessage } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { useFilterOptions } from '../components/FilterBar';
import {
  Callout, Card, CardHeader, EmptyState, ErrorState, LoadingBlock, Modal, PageHeader, ProgressBar, useToast,
} from '../components/ui';
import { decimal, formatDate, num, relativeTime } from '../lib/format';
import type { Goal, GoalMetric, GoalRosterRow, TargetOutcome } from '../types/api';

const METRICS: { metric: GoalMetric; label: string; decimals: number }[] = [
  { metric: 'PROBLEMS_SOLVED', label: 'Problems solved', decimals: 0 },
  { metric: 'CONTESTS_ATTENDED', label: 'Contests entered', decimals: 0 },
  { metric: 'CP_SCORE', label: 'CP score', decimals: 1 },
  { metric: 'CONTEST_RATING', label: 'Contest rating', decimals: 0 },
  { metric: 'TOPICS_COVERED', label: 'Topics covered', decimals: 0 },
];

const OUTCOME_LABEL: Record<TargetOutcome, string> = {
  MET: 'Met',
  BEHIND: 'Short',
  UNKNOWN: 'Not measurable',
  NO_DATA: 'No data',
};

const OUTCOME_TONE: Record<TargetOutcome, string> = {
  MET: 'bg-positive/10 text-positive',
  BEHIND: 'bg-caution/10 text-caution',
  // Deliberately not a warning colour. An unmeasurable metric is a gap in what
  // the platform publishes, not a student falling short.
  UNKNOWN: 'bg-surface-muted text-ink-muted',
  NO_DATA: 'bg-surface-muted text-ink-muted',
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function GoalsPage() {
  const { can } = useAuth();
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Goal | 'new' | null>(null);
  const [roster, setRoster] = useState<{ goal: Goal; metric?: GoalMetric; outcome?: TargetOutcome } | null>(null);
  const [includeInactive, setIncludeInactive] = useState(false);

  const query = useQuery({
    queryKey: ['goals', includeInactive],
    queryFn: () => goalsApi.list({ includeInactive }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => goalsApi.remove(id),
    onSuccess: () => {
      notify('Goal deleted', 'success');
      void queryClient.invalidateQueries({ queryKey: ['goals'] });
    },
    onError: (error) => notify(errorMessage(error), 'error'),
  });

  const goals = query.data ?? [];

  return (
    <>
      <PageHeader
        title="Goals"
        subtitle="Targets a cohort is working towards, and how far along it is."
        actions={
          <>
            <label className="flex items-center gap-2 text-xs text-ink-muted">
              <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
              Show archived
            </label>
            {can('TRAINER') && (
              <button type="button" className="btn-primary" onClick={() => setEditing('new')}>
                <Plus className="h-4 w-4" />
                New goal
              </button>
            )}
          </>
        }
      />

      {query.isLoading ? (
        <LoadingBlock rows={6} />
      ) : query.isError ? (
        <ErrorState message={errorMessage(query.error)} onRetry={() => query.refetch()} />
      ) : goals.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Target className="h-8 w-8" />}
            title="No goals yet"
            description="Set a target for a cohort — say 200 problems and 3 contests by December — and this page tracks how the batch is doing against it."
          />
        </Card>
      ) : (
        <div className="space-y-5">
          {goals.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              canEdit={can('TRAINER')}
              onEdit={() => setEditing(goal)}
              onDelete={() => {
                if (window.confirm(`Delete "${goal.name}"? Progress against it is not stored, so nothing else is lost.`)) {
                  remove.mutate(goal.id);
                }
              }}
              onDrill={(metric, outcome) => setRoster({ goal, metric, outcome })}
            />
          ))}
        </div>
      )}

      {editing && (
        <GoalEditor
          goal={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void queryClient.invalidateQueries({ queryKey: ['goals'] });
          }}
        />
      )}

      {roster && <RosterModal state={roster} onClose={() => setRoster(null)} />}
    </>
  );
}

function GoalCard({
  goal,
  canEdit,
  onEdit,
  onDelete,
  onDrill,
}: {
  goal: Goal;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onDrill: (metric: GoalMetric, outcome: TargetOutcome) => void;
}) {
  const overdue = goal.daysLeft < 0;
  const unmeasurable = goal.progress.targets.reduce((n, t) => n + t.unknown + t.noData, 0);

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {goal.name}
            <span className="badge bg-brand/10 text-brand">{goal.scope}</span>
            {!goal.isActive && <span className="badge bg-surface-muted text-ink-muted">Archived</span>}
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="flex items-center gap-1.5">
              <CalendarClock className="h-3.5 w-3.5" />
              {formatDate(goal.startsOn)} → {formatDate(goal.dueOn)}
            </span>
            <span className={clsx(overdue ? 'text-negative' : goal.daysLeft <= 14 ? 'text-caution' : 'text-ink-muted')}>
              {overdue ? `Overdue by ${Math.abs(goal.daysLeft)} days` : `${goal.daysLeft} days left`}
            </span>
            <span>{num(goal.progress.studentsInScope)} students in scope</span>
          </span>
        }
        actions={
          canEdit && (
            <>
              <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={onEdit}>
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </button>
              <button type="button" className="btn-ghost px-2 py-1 text-xs text-negative" onClick={onDelete}>
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            </>
          )
        }
      />

      {goal.description && <p className="px-5 pt-3 text-sm text-ink-muted">{goal.description}</p>}

      <div className="space-y-4 px-5 py-4">
        {goal.progress.targets.map((target) => {
          const measurable = target.met + target.behind;
          return (
            <div key={target.metric}>
              <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="text-sm font-medium text-ink">
                  {target.label} <span className="text-ink-muted">≥ {num(target.target)}</span>
                </p>
                <p className="tabular text-xs text-ink-muted">
                  {target.metRate === null ? (
                    // Never render this as 0% — that reads as "everybody failed"
                    // when what happened is that nobody could be measured.
                    <span className="text-ink-subtle">Not measurable for anyone in scope</span>
                  ) : (
                    <>
                      <span className="font-medium text-ink">{decimal(target.metRate, 1)}%</span> of{' '}
                      {num(measurable)} measurable
                    </>
                  )}
                </p>
              </div>

              <ProgressBar value={target.met} max={Math.max(1, measurable)} />

              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {(
                  [
                    ['MET', target.met],
                    ['BEHIND', target.behind],
                    ['UNKNOWN', target.unknown],
                    ['NO_DATA', target.noData],
                  ] as [TargetOutcome, number][]
                )
                  .filter(([, count]) => count > 0)
                  .map(([outcome, count]) => (
                    <button
                      key={outcome}
                      type="button"
                      className={clsx('badge hover:opacity-80', OUTCOME_TONE[outcome])}
                      title="See the students behind this number"
                      onClick={() => onDrill(target.metric, outcome)}
                    >
                      <Users className="h-3 w-3" />
                      {num(count)} {OUTCOME_LABEL[outcome].toLowerCase()}
                    </button>
                  ))}
                {target.medianRemaining !== null && target.behind > 0 && (
                  <span className="badge bg-surface-muted text-ink-muted">
                    typically {num(target.medianRemaining)} short
                  </span>
                )}
              </div>
            </div>
          );
        })}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-xs text-ink-muted">
          <span>
            <span className="font-medium text-ink">{num(goal.progress.onTrack)}</span> of{' '}
            {num(goal.progress.studentsInScope)} are meeting every target that can be measured for them
          </span>
          {goal.createdBy && <span>Set by {goal.createdBy}</span>}
        </div>

        {unmeasurable > 0 && (
          <Callout tone="info" title="Some students cannot be measured against this goal">
            Their platforms do not publish one of these metrics, or nothing has been retrieved for them yet. They are
            counted separately rather than as missing the target — a gap in the data is not a student falling short.
          </Callout>
        )}
      </div>
    </Card>
  );
}

function RosterModal({
  state,
  onClose,
}: {
  state: { goal: Goal; metric?: GoalMetric; outcome?: TargetOutcome };
  onClose: () => void;
}) {
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['goal-roster', state.goal.id, state.metric, state.outcome, page],
    queryFn: () => goalsApi.roster(state.goal.id, { metric: state.metric, outcome: state.outcome, page, pageSize: 50 }),
  });

  const label = state.outcome ? OUTCOME_LABEL[state.outcome] : 'All';

  return (
    <Modal open onClose={onClose} wide title={`${state.goal.name} — ${label.toLowerCase()}`}>
      {query.isLoading ? (
        <LoadingBlock rows={5} />
      ) : query.isError ? (
        <ErrorState message={errorMessage(query.error)} />
      ) : (query.data?.data.length ?? 0) === 0 ? (
        <EmptyState title="Nobody here" description="No student in scope falls into this group." />
      ) : (
        <>
          <p className="mb-3 text-xs text-ink-muted">
            {num(query.data!.pagination.total)} students. Every figure on the goal card opens into the names behind it.
          </p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Cohort</th>
                  {state.goal.targets
                    .filter((t) => !state.metric || t.metric === state.metric)
                    .map((t) => (
                      <th key={t.metric}>{t.label}</th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {query.data!.data.map((row: GoalRosterRow) => (
                  <tr key={row.id}>
                    <td>
                      <Link to={`/students/${row.id}`} className="font-medium text-ink hover:text-brand">
                        {row.name}
                      </Link>
                      <span className="block text-2xs text-ink-subtle">{row.studentId}</span>
                    </td>
                    <td className="text-xs text-ink-muted">{[row.batch, row.branch].filter(Boolean).join(' · ')}</td>
                    {row.targets
                      .filter((t) => !state.metric || t.metric === state.metric)
                      .map((t) => (
                        <td key={t.metric} className="tabular text-xs">
                          <span className={clsx('badge', OUTCOME_TONE[t.outcome])}>{OUTCOME_LABEL[t.outcome]}</span>
                          {t.value !== null && (
                            <span className="ml-1.5 text-ink-muted">
                              {num(t.value)} / {num(t.target)}
                            </span>
                          )}
                        </td>
                      ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {query.data!.pagination.totalPages > 1 && (
            <div className="mt-3 flex items-center justify-between text-xs text-ink-muted">
              <button type="button" className="btn-secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>
                Previous
              </button>
              <span>
                Page {page} of {query.data!.pagination.totalPages}
              </span>
              <button
                type="button"
                className="btn-secondary"
                disabled={page >= query.data!.pagination.totalPages}
                onClick={() => setPage(page + 1)}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

function GoalEditor({ goal, onClose, onSaved }: { goal: Goal | null; onClose: () => void; onSaved: () => void }) {
  const { notify } = useToast();
  const { data: options } = useFilterOptions();

  const [form, setForm] = useState({
    name: goal?.name ?? '',
    description: goal?.description ?? '',
    college: goal?.college ?? '',
    batch: goal?.batch ?? '',
    branch: goal?.branch ?? '',
    section: goal?.section ?? '',
    startsOn: goal ? goal.startsOn.slice(0, 10) : iso(new Date()),
    dueOn: goal ? goal.dueOn.slice(0, 10) : iso(new Date(Date.now() + 90 * 86_400_000)),
    isActive: goal?.isActive ?? true,
  });

  const [targets, setTargets] = useState<Record<GoalMetric, string>>(() => {
    const initial = {} as Record<GoalMetric, string>;
    for (const m of METRICS) initial[m.metric] = '';
    for (const t of goal?.targets ?? []) initial[t.metric] = String(t.target);
    return initial;
  });

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => (goal ? goalsApi.update(goal.id, body) : goalsApi.create(body)),
    onSuccess: () => {
      notify(goal ? 'Goal updated' : 'Goal created', 'success');
      onSaved();
    },
    onError: (error) => notify(errorMessage(error), 'error'),
  });

  const chosen = METRICS.filter((m) => targets[m.metric].trim() !== '').map((m) => ({
    metric: m.metric,
    target: Number(targets[m.metric]),
  }));
  const valid = form.name.trim().length >= 2 && chosen.length > 0 && form.dueOn > form.startsOn;

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={goal ? 'Edit goal' : 'New goal'}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!valid || save.isPending}
            onClick={() =>
              save.mutate({
                ...form,
                description: form.description || null,
                college: form.college || null,
                batch: form.batch || null,
                branch: form.branch || null,
                section: form.section || null,
                targets: chosen,
              })
            }
          >
            {goal ? 'Save goal' : 'Create goal'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block">
          <span className="label">Name</span>
          <input
            className="input"
            value={form.name}
            placeholder="Placement readiness"
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>

        <label className="block">
          <span className="label">Description</span>
          <textarea
            className="input"
            rows={2}
            value={form.description}
            placeholder="What this goal is for, so the number means something in six months."
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </label>

        <div>
          <p className="label">Who it applies to</p>
          <p className="mb-2 text-xs text-ink-muted">Leave a field blank to widen the goal. All blank means everyone.</p>
          <div className="grid gap-3 sm:grid-cols-4">
            {(
              [
                ['college', options?.colleges ?? []],
                ['batch', options?.batches ?? []],
                ['branch', options?.branches ?? []],
                ['section', options?.sections ?? []],
              ] as const
            ).map(([field, values]) => (
              <label key={field} className="block">
                <span className="label capitalize">{field}</span>
                <select
                  className="input"
                  value={form[field]}
                  onChange={(e) => setForm({ ...form, [field]: e.target.value })}
                >
                  <option value="">Any</option>
                  {values.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">Starts on</span>
            <input
              type="date"
              className="input"
              value={form.startsOn}
              onChange={(e) => setForm({ ...form, startsOn: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="label">Due on</span>
            <input
              type="date"
              className="input"
              value={form.dueOn}
              onChange={(e) => setForm({ ...form, dueOn: e.target.value })}
            />
          </label>
        </div>

        <div>
          <p className="label">Targets</p>
          <p className="mb-2 text-xs text-ink-muted">
            Absolute totals to reach, not gains — leave a metric blank to skip it. A student whose platforms do not
            publish a metric is reported as unmeasurable, never as missing the target.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {METRICS.map((m) => (
              <label key={m.metric} className="block">
                <span className="label">{m.label}</span>
                <input
                  type="number"
                  min={0}
                  step={m.decimals > 0 ? 0.1 : 1}
                  className="input"
                  value={targets[m.metric]}
                  placeholder="—"
                  onChange={(e) => setTargets({ ...targets, [m.metric]: e.target.value })}
                />
              </label>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2.5">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
          />
          <span className="text-sm text-ink">Active — archived goals stop appearing on student pages</span>
        </label>

        {goal && (
          <p className="text-2xs text-ink-subtle">
            Created {relativeTime(goal.createdAt)}
            {goal.createdBy ? ` by ${goal.createdBy}` : ''}. Editing the targets replaces them, so progress is measured
            against one set of numbers rather than a mix.
          </p>
        )}
      </div>
    </Modal>
  );
}
