import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { CircleAlert, ExternalLink, Link2Off, Target, TrendingUp } from 'lucide-react';
import { shareApi } from '../api/endpoints';
import { errorMessage } from '../api/client';
import { useTheme } from '../hooks/useTheme';
import { Callout, Card, CardHeader, DataValue, EmptyState, LoadingBlock, SkillBadge, StatusBadge, ProgressBar } from '../components/ui';
import { MultiLineChart, ScoreGauge } from '../components/charts';
import { decimal, formatDate, num, relativeTime } from '../lib/format';
import type { SharedProfile, StudentGoal, TargetOutcome } from '../types/api';

const OUTCOME_TONE: Record<TargetOutcome, string> = {
  MET: 'bg-positive/10 text-positive',
  BEHIND: 'bg-caution/10 text-caution',
  UNKNOWN: 'bg-surface-muted text-ink-muted',
  NO_DATA: 'bg-surface-muted text-ink-muted',
};

/**
 * A student's own view of their record, opened from a link rather than an
 * account.
 *
 * Deliberately outside the application shell: no navigation, no other students,
 * nothing that implies access to anything but this one page. It is the same
 * data the coordinator sees about this student, with the same refusal to turn
 * an unknown into a zero, minus contact details and internal notes.
 */
export default function SharedProfilePage() {
  const { token } = useParams<{ token: string }>();
  const { mode } = useTheme();

  const query = useQuery({
    queryKey: ['shared-profile', token],
    queryFn: () => shareApi.shared(token!),
    enabled: Boolean(token),
    retry: false,
  });

  if (query.isLoading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16">
        <LoadingBlock rows={6} />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <div className="mx-auto max-w-lg px-4 py-24">
        <Card>
          <EmptyState
            icon={<Link2Off className="h-8 w-8" />}
            title="This link is not valid"
            description={errorMessage(query.error, 'Ask your coordinator for a new link.')}
          />
        </Card>
      </div>
    );
  }

  const data = query.data;
  const dark = mode === 'dark';

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
      <header className="mb-6">
        <p className="text-xs font-medium uppercase tracking-wide text-brand">Your coding profile</p>
        <h1 className="mt-1 text-2xl font-semibold text-ink">{data.student.name}</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {[data.student.studentId, data.student.branch, data.student.batch, data.student.college]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <p className="mt-2 text-xs text-ink-subtle">
          {data.lastRefreshedAt
            ? `Last updated ${relativeTime(data.lastRefreshedAt)}. This page is read-only and updates when your college refreshes the data.`
            : 'Nothing has been retrieved for you yet. This page fills in once your college runs a refresh.'}
        </p>
      </header>

      <Summary data={data} />

      {data.concerns.length > 0 && (
        <div className="mb-6 space-y-2">
          {data.concerns.map((concern) => (
            <Callout key={concern.type} tone={concern.severity === 'CRITICAL' ? 'danger' : 'warning'} title="Worth a look">
              {concern.message}
            </Callout>
          ))}
        </div>
      )}

      {data.goals.length > 0 && (
        <Card className="mb-6">
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <Target className="h-4 w-4 text-ink-muted" />
                Your goals
              </span>
            }
            subtitle="Targets your college has set for your cohort."
          />
          <div className="space-y-5 px-5 py-4">
            {data.goals.map((goal) => (
              <GoalBlock key={goal.id} goal={goal} />
            ))}
          </div>
        </Card>
      )}

      <Card className="mb-6">
        <CardHeader title="Your platforms" subtitle="What each site publishes about you, exactly as it was retrieved." />
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Platform</th>
                <th>Handle</th>
                <th>Status</th>
                <th className="text-right">Solved</th>
                <th className="text-right">Rating</th>
                <th className="text-right">Contests</th>
              </tr>
            </thead>
            <tbody>
              {data.platforms.map((p) => (
                <tr key={p.platform}>
                  <td>
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: dark ? p.colorDark : p.color }}
                        aria-hidden
                      />
                      {p.label}
                    </span>
                  </td>
                  <td>
                    <a
                      href={p.profileUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1 text-brand hover:underline"
                    >
                      {p.username}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </td>
                  <td>
                    <StatusBadge status={p.status} message={p.statusMessage} />
                  </td>
                  <td className="text-right">
                    <DataValue value={p.totalSolved} status={p.status} />
                  </td>
                  <td className="text-right">
                    <DataValue
                      value={p.rating}
                      status={p.status}
                      reason={p.capabilities.hasContests ? null : `${p.label} does not publish a rating.`}
                    />
                  </td>
                  <td className="text-right">
                    <DataValue
                      value={p.contestsAttended}
                      status={p.status}
                      reason={p.capabilities.hasContests ? null : `${p.label} does not publish a contest history.`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {data.unlinkedPlatforms.length > 0 && (
          <p className="border-t border-line px-5 py-3 text-xs text-ink-muted">
            Not linked yet: {data.unlinkedPlatforms.map((p) => p.label).join(', ')}. Ask your coordinator to add your
            handle if you have an account.
          </p>
        )}
      </Card>

      <div className="mb-6 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Your strongest topics" subtitle="Ranked by how much you have solved in each." />
          {data.skills.length === 0 ? (
            <EmptyState
              title="No topic breakdown yet"
              description="Only LeetCode and Codeforces publish a topic breakdown. If neither is linked and working, there is nothing to show here."
            />
          ) : (
            <ul className="divide-y divide-line">
              {data.skills.slice(0, 10).map((skill) => (
                <li key={skill.topic} className="flex items-center justify-between gap-3 px-5 py-2.5">
                  <span className="truncate text-sm text-ink">{skill.topic}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="tabular text-xs text-ink-muted">{num(skill.problemsSolved)}</span>
                    <SkillBadge level={skill.level} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Where to focus next"
            subtitle="The topics you have solved least in, among those your platforms report."
          />
          {data.topics.length === 0 ? (
            <EmptyState title="No topics reported" description="Nothing to rank until a platform publishes a topic breakdown for you." />
          ) : (
            <ul className="divide-y divide-line">
              {[...data.topics]
                .reverse()
                .slice(0, 10)
                .map((topic) => (
                  <li key={topic.topic} className="flex items-center justify-between gap-3 px-5 py-2.5">
                    <span className="truncate text-sm text-ink">{topic.topic}</span>
                    <span className="tabular shrink-0 text-xs text-ink-muted">{num(topic.problemsSolved)} solved</span>
                  </li>
                ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-ink-muted" />
              Your progress
            </span>
          }
          subtitle="Every dated reading taken of your profile, not a projection."
        />
        <div className="px-3 pb-4 pt-2">
          <MultiLineChart
            height={260}
            series={[
              {
                key: 'solved',
                label: 'Problems solved',
                color: 'rgb(var(--brand))',
                points: data.history.map((h) => ({ x: h.capturedAt.slice(0, 10), y: h.totalSolved })),
              },
            ]}
            xLabelFormatter={(v) => formatDate(String(v))}
          />
        </div>
      </Card>

      <p className="pb-8 text-center text-2xs text-ink-subtle">
        This page shows only your own record. The CP score is calculated by this application from public profile data —
        it is not an official score from any of these platforms.
      </p>
    </div>
  );
}

function Summary({ data }: { data: SharedProfile }) {
  const a = data.analytics;

  return (
    <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card className="flex items-center justify-center py-4">
        <ScoreGauge score={a?.hasData ? a.cpScore : null} />
      </Card>

      <Card className="px-5 py-4">
        <p className="text-xs text-ink-muted">Problems solved</p>
        <p className="tabular mt-1 text-2xl font-semibold text-ink">
          <DataValue value={a?.hasData ? a.totalSolved : null} reason="Nothing has been retrieved for you yet." />
        </p>
        <p className="mt-1 text-2xs text-ink-subtle">
          {a?.difficultyKnown
            ? `${num(a.easySolved)} easy · ${num(a.mediumSolved)} medium · ${num(a.hardSolved)} hard`
            : 'No difficulty split — none of your working platforms publishes one.'}
        </p>
      </Card>

      <Card className="px-5 py-4">
        <p className="text-xs text-ink-muted">Contest rating</p>
        <p className="tabular mt-1 text-2xl font-semibold text-ink">
          <DataValue
            value={a?.currentRating ?? null}
            reason="No linked platform publishes a rating for you. That is not a rating of zero."
          />
        </p>
        <p className="mt-1 text-2xs text-ink-subtle">
          {a?.contestsKnown ? `${num(a.totalContests)} contests entered` : 'Contest history not published'}
        </p>
      </Card>

      <Card className="px-5 py-4">
        <p className="text-xs text-ink-muted">Your position</p>
        {data.rank ? (
          <>
            <p className="tabular mt-1 text-2xl font-semibold text-ink">
              {num(data.rank.position)}
              <span className="text-base font-normal text-ink-muted"> of {num(data.rank.of)}</span>
            </p>
            <p className="mt-1 text-2xs text-ink-subtle">Within {data.rank.scope}, by CP score.</p>
          </>
        ) : (
          <>
            <p className="mt-1 text-2xl font-semibold text-ink-subtle">N/A</p>
            <p className="mt-1 text-2xs text-ink-subtle">
              You are not ranked until at least one platform returns data — an unranked student is not last.
            </p>
          </>
        )}
      </Card>
    </div>
  );
}

function GoalBlock({ goal }: { goal: StudentGoal }) {
  const overdue = goal.daysLeft < 0;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-sm font-medium text-ink">{goal.name}</p>
        <p className={clsx('text-xs', overdue ? 'text-negative' : goal.daysLeft <= 14 ? 'text-caution' : 'text-ink-muted')}>
          {overdue ? `Closed ${Math.abs(goal.daysLeft)} days ago` : `${goal.daysLeft} days left`} · due{' '}
          {formatDate(goal.dueOn)}
        </p>
      </div>

      <div className="space-y-3">
        {goal.targets.map((t) => (
          <div key={t.metric}>
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className="text-xs text-ink">
                {t.label}
                <span className="ml-1.5 text-ink-muted">
                  {t.value === null ? 'N/A' : num(t.value)} / {num(t.target)}
                </span>
              </span>
              <span className={clsx('badge', OUTCOME_TONE[t.outcome])}>
                {t.outcome === 'MET'
                  ? 'Done'
                  : t.outcome === 'BEHIND'
                    ? `${num(t.remaining)} to go`
                    : t.outcome === 'UNKNOWN'
                      ? 'Not measurable for you'
                      : 'No data yet'}
              </span>
            </div>

            {t.value !== null && <ProgressBar value={t.value} max={Math.max(t.target, t.value)} />}

            {t.outcome === 'BEHIND' && t.requiredPerWeek !== null && (
              <p className="mt-1 text-2xs text-ink-subtle">
                About {decimal(t.requiredPerWeek, 1)} a week from here.
                {t.observedGain !== null && t.observedOverDays !== null && (
                  <> You have gained {num(t.observedGain)} over the last {num(t.observedOverDays)} days.</>
                )}
              </p>
            )}

            {t.outcome === 'UNKNOWN' && (
              <p className="mt-1 flex items-start gap-1 text-2xs text-ink-subtle">
                <CircleAlert className="mt-0.5 h-3 w-3 shrink-0" />
                None of your linked platforms publishes this, so it cannot be measured for you. It is not counted against
                you.
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
