import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, ExternalLink, RefreshCw } from 'lucide-react';
import { studentsApi } from '../api/endpoints';
import { downloadFile, errorMessage } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../hooks/useTheme';
import {
  Callout, Card, DataValue, EmptyState, ErrorState, LoadingBlock, PageHeader,
  SkillBadge, StatCard, StatusBadge, Tabs, useToast,
} from '../components/ui';
import { CategoryBars, CompositionBar, MultiLineChart, ScoreGauge } from '../components/charts';
import { decimal, formatDate, num, ordinalRank, percent, relativeTime, STATUS_PRESENTATION } from '../lib/format';
import { difficultyColor } from '../lib/palette';
import type { PlatformProfile, StudentSkill } from '../types/api';

type TabId = 'overview' | 'topics' | 'contests' | 'skills' | 'history' | 'score';

export default function StudentDetailPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const { mode } = useTheme();
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabId>('overview');

  const student = useQuery({ queryKey: ['student', id], queryFn: () => studentsApi.detail(id) });

  const refresh = useMutation({
    mutationFn: () => studentsApi.refreshOne(id, { force: true }),
    onSuccess: (job) => {
      notify(`Refresh queued as job #${job.number}.`, 'success');
      queryClient.invalidateQueries({ queryKey: ['student', id] });
    },
    onError: (error) => notify(errorMessage(error), 'error'),
  });

  if (student.isLoading) return <LoadingBlock rows={8} />;
  if (student.isError) return <ErrorState message={errorMessage(student.error)} onRetry={() => student.refetch()} />;

  const data = student.data!;
  const analytics = data.analytics;
  const hasData = analytics?.hasData ?? false;

  // A metric is only knowable if some platform that actually returned data
  // publishes it. Without this, a student whose only working platform is
  // CodeChef would show "Easy 0 / Medium 0 / Hard 0" and "0 topics" — which
  // asserts they solved none, when the truth is that nobody published a split.
  const sources = {
    difficulty: data.platforms.some((p) => p.status === 'AVAILABLE' && p.capabilities.hasDifficultyBreakdown),
    topics: data.platforms.some((p) => p.status === 'AVAILABLE' && p.capabilities.hasTopics),
    contests: data.platforms.some((p) => p.status === 'AVAILABLE' && p.capabilities.hasContests),
  };

  return (
    <>
      <Link to="/students" className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted hover:text-ink">
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to students
      </Link>

      <PageHeader
        title={data.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span>Student ID: {data.studentId}</span>
            {[data.branch, data.batch, data.section, data.college].filter(Boolean).map((part) => (
              <span key={String(part)} className="before:mr-2 before:text-ink-subtle before:content-['|']">{part}</span>
            ))}
          </span>
        }
        actions={
          <>
            {can('TRAINER') && (
              <button type="button" className="btn-secondary" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
                <RefreshCw className={`h-4 w-4 ${refresh.isPending ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            )}
            {(['pdf', 'xlsx'] as const).map((format) => (
              <button
                key={format}
                type="button"
                className="btn-secondary"
                onClick={() =>
                  downloadFile(`/api/reports/student/${id}?format=${format}`, `student-report.${format}`).catch((error) =>
                    notify(errorMessage(error), 'error'),
                  )
                }
              >
                <Download className="h-4 w-4" />
                {format.toUpperCase()}
              </button>
            ))}
          </>
        }
      />

      {!hasData && (
        <div className="mb-5">
          <Callout tone="warning" title="No platform data has been retrieved for this student">
            {data.platforms.length === 0
              ? 'No coding profile handles are on file. Edit the student or re-import them with handles.'
              : 'Every linked profile is unavailable — see the platform cards below for the reason on each.'}
          </Callout>
        </div>
      )}

      {/* Headline metrics */}
      <div className="mb-5 grid gap-4 lg:grid-cols-[auto_1fr]">
        <Card className="flex items-center gap-5 p-5">
          <ScoreGauge score={hasData ? analytics!.cpScore : null} />
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Competitive Programming Score</p>
            <p className="mt-1 max-w-[16rem] text-2xs text-ink-subtle">
              Generated by this application from public data. Not an official platform metric.
            </p>
            <button type="button" className="btn-ghost mt-2 px-0 text-xs text-brand" onClick={() => setTab('score')}>
              See how it is calculated →
            </button>
          </div>
        </Card>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Problems solved" value={<DataValue value={hasData ? analytics!.totalSolved : null} />} hint={`${data.platforms.filter((p) => p.status === 'AVAILABLE').length} of ${data.platforms.length} platforms reporting`} />
          <StatCard
            label="Contests"
            value={<DataValue value={hasData && sources.contests ? analytics!.totalContests : null} reason="No platform that returned data publishes contest participation." />}
            hint={analytics?.bestRank ? `Best rank ${ordinalRank(analytics.bestRank)}` : undefined}
          />
          <StatCard label="Best rating" value={<DataValue value={analytics?.bestRating ?? null} />} hint={analytics?.currentRating ? `Current ${num(analytics.currentRating)}` : 'No rating published'} />
          <StatCard
            label="Topics covered"
            value={<DataValue value={hasData && sources.topics ? analytics!.topicCount : null} reason="No platform that returned data publishes a topic breakdown." />}
            hint={hasData && sources.topics ? `${percent(analytics!.topicCoverage)} of target` : undefined}
          />
        </div>
      </div>

      {/* Platform cards */}
      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {data.platforms.length === 0 ? (
          <Card className="sm:col-span-2 xl:col-span-4">
            <EmptyState title="No platform handles on file" description="This student was imported without any coding profile handles." />
          </Card>
        ) : (
          data.platforms.map((profile) => <PlatformCard key={profile.id} profile={profile} />)
        )}
      </div>

      <Card>
        <Tabs<TabId>
          active={tab}
          onChange={setTab}
          tabs={[
            { id: 'overview', label: 'Overview' },
            { id: 'topics', label: 'Topics', count: data.topics.length },
            { id: 'contests', label: 'Contests', count: data.contestCount },
            { id: 'skills', label: 'Skill matrix', count: data.skills.length },
            { id: 'history', label: 'Growth' },
            { id: 'score', label: 'Score breakdown' },
          ]}
        />

        <div className="p-5">
          {tab === 'overview' && <OverviewTab data={data} mode={mode} sources={sources} />}
          {tab === 'topics' && <TopicsTab id={id} />}
          {tab === 'contests' && <ContestsTab id={id} />}
          {tab === 'skills' && <SkillsTab skills={data.skills} />}
          {tab === 'history' && <HistoryTab id={id} />}
          {tab === 'score' && <ScoreTab id={id} hasData={hasData} />}
        </div>
      </Card>
    </>
  );
}

function PlatformCard({ profile }: { profile: PlatformProfile }) {
  const available = profile.status === 'AVAILABLE';
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: profile.color }} aria-hidden />
            {profile.label}
          </p>
          <a
            href={profile.profileUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-0.5 inline-flex items-center gap-1 truncate text-xs text-ink-muted hover:text-brand"
          >
            {profile.username}
            <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
          </a>
        </div>
        <StatusBadge status={profile.status} message={profile.statusMessage} />
      </div>

      {!available ? (
        <p className="text-xs text-ink-muted">
          {profile.statusMessage ?? STATUS_PRESENTATION[profile.status].hint}
          {profile.lastSuccessAt && (
            <span className="mt-1 block text-ink-subtle">
              Showing nothing rather than stale zeros. Last successful fetch {relativeTime(profile.lastSuccessAt)}.
            </span>
          )}
        </p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
          <Field label="Solved" value={profile.totalSolved} note={!profile.capabilities.hasDifficultyBreakdown ? 'No difficulty split published' : undefined} />
          <Field label="Rating" value={profile.rating} note="Not published by this platform" />
          <Field label="Rank" value={profile.globalRank} format={(value) => ordinalRank(Number(value))} note="Not published by this platform" />
          <Field label="Contests" value={profile.contestsAttended} note="No contest data published" />
          {profile.capabilities.hasDifficultyBreakdown && (
            <>
              <Field label="Easy" value={profile.easySolved} />
              <Field label="Medium" value={profile.mediumSolved} />
              <Field label="Hard" value={profile.hardSolved} />
            </>
          )}
          {profile.problemSolvingScore !== null && <Field label="Score" value={profile.problemSolvingScore} />}
          {profile.stars && <Field label="Stars" value={profile.stars as never} />}
          {profile.acceptanceRate !== null && <Field label="Acceptance" value={profile.acceptanceRate} format={(v) => percent(v as number)} />}
        </dl>
      )}

      <p className="mt-3 border-t border-line pt-2 text-2xs text-ink-subtle">
        Updated {relativeTime(profile.lastSuccessAt ?? profile.lastFetchedAt)}
      </p>
    </Card>
  );
}

function Field({
  label,
  value,
  note,
  format,
}: {
  label: string;
  value: number | string | null;
  note?: string;
  format?: (value: number | string) => string;
}) {
  return (
    <div>
      <dt className="text-ink-subtle">{label}</dt>
      <dd className="tabular font-medium text-ink">
        {value === null || value === undefined ? (
          <span className="text-ink-subtle" title={note ?? 'Not published by this platform'}>N/A</span>
        ) : format ? (
          format(value)
        ) : typeof value === 'number' ? (
          num(value)
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

function OverviewTab({
  data,
  mode,
  sources,
}: {
  data: NonNullable<ReturnType<typeof useQuery<Awaited<ReturnType<typeof studentsApi.detail>>>>['data']>;
  mode: 'light' | 'dark';
  sources: { difficulty: boolean; topics: boolean; contests: boolean };
}) {
  const analytics = data.analytics;
  const hasData = analytics?.hasData ?? false;
  const withSolved = data.platforms.filter((p) => p.totalSolved !== null);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <h3 className="mb-3 text-sm font-semibold text-ink">Problems solved by platform</h3>
        {withSolved.length === 0 ? (
          <EmptyState title="No solved counts available" description="No platform published a solved total for this student." />
        ) : (
          <CategoryBars
            data={withSolved.map((profile) => ({
              label: profile.label,
              value: profile.totalSolved,
              color: profile.color,
            }))}
          />
        )}
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold text-ink">Difficulty distribution</h3>
        {!hasData || !sources.difficulty ? (
          <EmptyState
            title="No difficulty breakdown available"
            description={
              hasData
                ? 'None of the platforms with data for this student publish an Easy/Medium/Hard split, so the breakdown is unknown rather than zero.'
                : 'No platform returned data for this student.'
            }
          />
        ) : (
          <>
            <CompositionBar
              segments={[
                { label: 'Easy', value: analytics!.easySolved, color: difficultyColor('EASY', mode) },
                { label: 'Medium', value: analytics!.mediumSolved, color: difficultyColor('MEDIUM', mode) },
                { label: 'Hard', value: analytics!.hardSolved, color: difficultyColor('HARD', mode) },
                {
                  label: 'Unclassified',
                  value: Math.max(0, analytics!.totalSolved - analytics!.easySolved - analytics!.mediumSolved - analytics!.hardSolved),
                  color: difficultyColor('UNCLASSIFIED', mode),
                },
              ]}
            />
            <p className="mt-3 text-2xs text-ink-subtle">
              CodeChef and HackerRank publish a solved total without an Easy/Medium/Hard split; those solves are counted as unclassified.
            </p>
          </>
        )}
      </div>

      <div className="lg:col-span-2">
        <h3 className="mb-3 text-sm font-semibold text-ink">Top topics</h3>
        {data.topics.length === 0 ? (
          <EmptyState title="No topic breakdown available" description="CodeChef does not publish topic data, and other platforms only expose it on public profiles." />
        ) : (
          <CategoryBars data={data.topics.slice(0, 12).map((topic) => ({ label: topic.topic, value: topic.problemsSolved }))} />
        )}
      </div>
    </div>
  );
}

function TopicsTab({ id }: { id: string }) {
  const query = useQuery({ queryKey: ['student-topics', id], queryFn: () => studentsApi.topics(id) });
  if (query.isLoading) return <LoadingBlock rows={6} />;
  if (query.isError) return <ErrorState message={errorMessage(query.error)} />;

  const { unified, byPlatform } = query.data!;
  if (unified.length === 0) {
    return <EmptyState title="No topic data" description="No platform published a topic breakdown for this student." />;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <h3 className="mb-3 text-sm font-semibold text-ink">All platforms combined</h3>
        <CategoryBars data={unified.map((topic) => ({ label: topic.topic, value: topic.problemsSolved }))} />
      </div>
      <div>
        <h3 className="mb-3 text-sm font-semibold text-ink">By platform</h3>
        <div className="space-y-5">
          {Object.entries(byPlatform).map(([platform, topics]) => (
            <div key={platform}>
              <p className="mb-2 text-xs font-medium text-ink-muted">{platform}</p>
              <CategoryBars data={topics.slice(0, 8).map((topic) => ({ label: topic.topic, value: topic.problemsSolved }))} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ContestsTab({ id }: { id: string }) {
  const contests = useQuery({ queryKey: ['student-contests', id], queryFn: () => studentsApi.contests(id) });
  const ratings = useQuery({ queryKey: ['student-ratings', id], queryFn: () => studentsApi.ratings(id) });

  if (contests.isLoading) return <LoadingBlock rows={6} />;
  if (contests.isError) return <ErrorState message={errorMessage(contests.error)} />;

  const data = contests.data!;
  if (data.data.length === 0) {
    return <EmptyState title="No contest history" description="No platform published contest participation for this student." />;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Contests" value={num(data.summary.total)} />
        <StatCard label="Best rank" value={<DataValue value={data.summary.bestRank} />} />
        <StatCard label="Average rank" value={<DataValue value={data.summary.averageRank} />} />
        <StatCard label="Platforms" value={num(data.summary.byPlatform.length)} hint={data.summary.byPlatform.map((p) => p.label).join(', ')} />
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold text-ink">Rating over time</h3>
        <MultiLineChart
          height={280}
          yLabel="Rating"
          series={(ratings.data ?? []).map((series) => ({
            key: series.platform,
            label: series.label,
            color: series.color,
            points: series.points.map((point) => ({ x: point.date.slice(0, 10), y: point.rating })),
          }))}
          xLabelFormatter={(value) => formatDate(String(value))}
        />
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Platform</th><th>Contest</th><th>Date</th>
              <th className="text-right">Rank</th><th className="text-right">Before</th>
              <th className="text-right">After</th><th className="text-right">Change</th><th className="text-right">Solved</th>
            </tr>
          </thead>
          <tbody>
            {data.data.slice(0, 100).map((contest) => (
              <tr key={contest.id}>
                <td className="text-xs text-ink-muted">{contest.platform}</td>
                <td className="max-w-[16rem] truncate" title={contest.name}>
                  {contest.url ? (
                    <a href={contest.url} target="_blank" rel="noreferrer noopener" className="hover:text-brand">{contest.name}</a>
                  ) : contest.name}
                </td>
                <td className="whitespace-nowrap text-xs text-ink-muted">{formatDate(contest.date)}</td>
                <td className="text-right"><DataValue value={contest.rank} /></td>
                <td className="text-right"><DataValue value={contest.ratingBefore} /></td>
                <td className="text-right"><DataValue value={contest.ratingAfter} /></td>
                <td className="tabular text-right">
                  {contest.ratingChange === null ? (
                    <span className="text-ink-subtle">N/A</span>
                  ) : (
                    <span className={contest.ratingChange >= 0 ? 'text-positive' : 'text-negative'}>
                      {contest.ratingChange >= 0 ? '+' : ''}{contest.ratingChange}
                    </span>
                  )}
                </td>
                <td className="text-right"><DataValue value={contest.problemsSolved} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SkillsTab({ skills }: { skills: StudentSkill[] }) {
  if (skills.length === 0) {
    return <EmptyState title="Not enough topic data" description="A skill matrix needs topic breakdowns, which not every platform publishes." />;
  }

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Skill</th><th>Level</th>
            <th className="text-right">Problems</th>
            <th className="text-right">Platforms</th>
            <th className="text-right">Weighted score</th>
          </tr>
        </thead>
        <tbody>
          {skills.map((skill) => (
            <tr key={skill.id}>
              <td className="font-medium">{skill.topic}</td>
              <td><SkillBadge level={skill.level} /></td>
              <td className="tabular text-right">{num(skill.problemsSolved)}</td>
              <td className="tabular text-right">{skill.platformCount}</td>
              <td className="tabular text-right text-ink-muted">{decimal(skill.score)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-4 py-3 text-2xs text-ink-subtle">
        Levels combine the number of problems solved, how many platforms the topic appears on, and recent activity.
        Thresholds are configurable in Settings.
      </p>
    </div>
  );
}

function HistoryTab({ id }: { id: string }) {
  const query = useQuery({ queryKey: ['student-history', id], queryFn: () => studentsApi.history(id, { days: 365 }) });
  if (query.isLoading) return <LoadingBlock rows={6} />;
  if (query.isError) return <ErrorState message={errorMessage(query.error)} />;

  const history = query.data ?? [];
  if (history.length < 2) {
    return (
      <EmptyState
        title="Not enough history yet"
        description="Snapshots are captured each time a profile is refreshed. Growth charts appear once there are at least two."
      />
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <h3 className="mb-3 text-sm font-semibold text-ink">Problems solved</h3>
        <MultiLineChart
          height={240}
          series={[{ key: 'solved', label: 'Total solved', color: 'rgb(37 99 235)', points: history.map((h) => ({ x: h.date.slice(0, 10), y: h.totalSolved })) }]}
          xLabelFormatter={(v) => formatDate(String(v))}
        />
      </div>
      <div>
        <h3 className="mb-3 text-sm font-semibold text-ink">Rating</h3>
        <MultiLineChart
          height={240}
          series={[{ key: 'rating', label: 'Rating', color: 'rgb(22 163 74)', points: history.map((h) => ({ x: h.date.slice(0, 10), y: h.rating })) }]}
          xLabelFormatter={(v) => formatDate(String(v))}
        />
      </div>
      <div>
        <h3 className="mb-3 text-sm font-semibold text-ink">CP score</h3>
        <MultiLineChart
          height={240}
          series={[{ key: 'score', label: 'CP score', color: 'rgb(217 119 6)', points: history.map((h) => ({ x: h.date.slice(0, 10), y: h.cpScore })) }]}
          xLabelFormatter={(v) => formatDate(String(v))}
        />
      </div>
      <div>
        <h3 className="mb-3 text-sm font-semibold text-ink">Contests attended</h3>
        <MultiLineChart
          height={240}
          series={[{ key: 'contests', label: 'Contests', color: 'rgb(147 51 234)', points: history.map((h) => ({ x: h.date.slice(0, 10), y: h.contestsAttended })) }]}
          xLabelFormatter={(v) => formatDate(String(v))}
        />
      </div>
    </div>
  );
}

function ScoreTab({ id, hasData }: { id: string; hasData: boolean }) {
  const query = useQuery({ queryKey: ['student-score', id], queryFn: () => studentsApi.scorePreview(id, {}), enabled: hasData });

  if (!hasData) {
    return <EmptyState title="No score to explain" description="The score needs at least one platform with retrieved data." />;
  }
  if (query.isLoading) return <LoadingBlock rows={5} />;
  if (query.isError) return <ErrorState message={errorMessage(query.error)} />;

  const breakdown = query.data!;

  return (
    <div>
      <div className="mb-4 flex items-baseline gap-3">
        <span className="tabular text-3xl font-semibold text-ink">{decimal(breakdown.score, 1)}</span>
        <span className="text-sm text-ink-muted">out of 100</span>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Component</th><th className="text-right">Weight</th>
              <th className="text-right">Achieved</th><th className="text-right">Points</th><th>How it was calculated</th>
            </tr>
          </thead>
          <tbody>
            {breakdown.components.map((component) => (
              <tr key={component.key}>
                <td className="font-medium">{component.label}</td>
                <td className="tabular text-right">{component.weight}%</td>
                <td className="tabular text-right">{percent(component.achievement * 100, 0)}</td>
                <td className="tabular text-right font-medium">{decimal(component.points, 1)}</td>
                <td className="text-xs text-ink-muted">{component.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4">
        <Callout tone="info" title="This is not an official platform score">
          It is a composite generated by this application from the public data above. Weights and targets are configurable
          in Settings, and changing them recalculates every student's score.
        </Callout>
      </div>
    </div>
  );
}
