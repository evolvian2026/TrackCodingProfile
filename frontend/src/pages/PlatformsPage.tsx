import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { RefreshCw, Trash2 } from 'lucide-react';
import { analyticsApi, settingsApi, studentsApi } from '../api/endpoints';
import { errorMessage } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { Callout, Card, CardHeader, LoadingBlock, PageHeader, ProgressBar, StatusBadge, useToast } from '../components/ui';
import { num, relativeTime } from '../lib/format';
import type { Platform } from '../types/api';

export default function PlatformsPage() {
  const { can } = useAuth();
  const { notify } = useToast();
  const queryClient = useQueryClient();

  const meta = useQuery({ queryKey: ['platform-meta'], queryFn: settingsApi.platforms });
  const overview = useQuery({ queryKey: ['overview', {}], queryFn: () => analyticsApi.overview() });

  const refresh = useMutation({
    mutationFn: (platform: Platform) => studentsApi.refreshMany({ scope: 'all', platforms: [platform], force: true }),
    onSuccess: (job) => notify(`Job #${job.number} queued — ${job.totalItems} profiles.`, 'success'),
    onError: (error) => notify(errorMessage(error), 'error'),
  });

  const purge = useMutation({
    mutationFn: (platform?: Platform) => settingsApi.purgeCache({ platform }),
    onSuccess: (result) => {
      notify(`Cleared ${result.removed} cached responses.`, 'success');
      queryClient.invalidateQueries({ queryKey: ['overview'] });
    },
    onError: (error) => notify(errorMessage(error), 'error'),
  });

  const dataSource = meta.data?.dataSource;

  return (
    <>
      <PageHeader
        title="Platforms"
        subtitle="How each platform is queried, and how much of its data is actually public."
        actions={
          can('ADMIN') && (
            <button type="button" className="btn-secondary" disabled={purge.isPending} onClick={() => purge.mutate(undefined)}>
              <Trash2 className="h-4 w-4" />
              Clear all caches
            </button>
          )
        }
      />

      {dataSource === 'mock' && (
        <div className="mb-5">
          <Callout tone="warning" title="Running on mock data">
            <code className="rounded bg-surface-muted px-1 py-0.5 text-2xs">DATA_SOURCE=mock</code> — every figure here comes
            from deterministic sample responses, not from the real platforms. Set <code className="rounded bg-surface-muted px-1 py-0.5 text-2xs">DATA_SOURCE=live</code> to fetch real profiles.
          </Callout>
        </div>
      )}

      {meta.isLoading || overview.isLoading ? (
        <LoadingBlock rows={8} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {(meta.data?.data ?? []).map((platform) => {
            const stats = overview.data?.platforms.find((entry) => entry.platform === platform.key);
            return (
              <Card key={platform.key}>
                <CardHeader
                  title={
                    <span className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full" style={{ background: platform.color }} aria-hidden />
                      {platform.label}
                    </span>
                  }
                  subtitle={`Rate limit: ${platform.defaultRateLimitPerMinute} requests/minute`}
                  actions={
                    can('TRAINER') && (
                      <button
                        type="button"
                        className="btn-secondary px-2.5 py-1.5 text-xs"
                        disabled={refresh.isPending}
                        onClick={() => refresh.mutate(platform.key)}
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Refresh all
                      </button>
                    )
                  }
                />

                <div className="space-y-4 p-5">
                  <p className="text-sm text-ink-muted">{platform.dataSourceNote}</p>

                  <div>
                    <p className="mb-1.5 text-xs font-medium text-ink-muted">Publicly available from this platform</p>
                    <ul className="flex flex-wrap gap-1.5">
                      {[
                        ['Solved counts', true],
                        ['Difficulty split', platform.capabilities.hasDifficultyBreakdown],
                        ['Topic breakdown', platform.capabilities.hasTopics],
                        ['Contest history', platform.capabilities.hasContests],
                      ].map(([label, available]) => (
                        <li
                          key={String(label)}
                          className={`badge ${available ? 'bg-positive/10 text-positive' : 'bg-ink-subtle/15 text-ink-muted'}`}
                        >
                          {available ? '✓' : '✗'} {label}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {stats && (
                    <>
                      <div>
                        <div className="mb-1.5 flex items-baseline justify-between">
                          <p className="text-xs font-medium text-ink-muted">Data retrieved</p>
                          <p className="tabular text-xs text-ink-muted">{num(stats.available)} / {num(stats.linked)} linked profiles</p>
                        </div>
                        <ProgressBar value={stats.available} max={Math.max(1, stats.linked)} color={platform.color} />
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        {stats.pending > 0 && <StatusBadge status="PENDING" message={`${stats.pending} not fetched yet`} />}
                        {stats.notFound > 0 && <StatusBadge status="NOT_FOUND" message={`${stats.notFound} handles do not exist`} />}
                        {stats.private > 0 && <StatusBadge status="PRIVATE" message={`${stats.private} private profiles`} />}
                        {stats.unavailable > 0 && <StatusBadge status="UNAVAILABLE" message={`${stats.unavailable} unavailable`} />}
                        {stats.rateLimited > 0 && <StatusBadge status="RATE_LIMITED" message={`${stats.rateLimited} rate limited`} />}
                        {stats.error > 0 && <StatusBadge status="ERROR" message={`${stats.error} errored`} />}
                      </div>

                      <div className="flex items-center justify-between border-t border-line pt-3 text-2xs text-ink-subtle">
                        <span>Last successful fetch {relativeTime(stats.lastRefreshedAt)}</span>
                        {can('ADMIN') && (
                          <button type="button" className="hover:text-ink" onClick={() => purge.mutate(platform.key)}>
                            Clear cache
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <div className="mt-5">
        <Callout tone="info" title="Why some values show N/A">
          Each platform publishes a different subset of data. Where a platform does not expose something — HackerRank has no
          public contest history, CodeChef publishes no topic breakdown — the value is recorded as unavailable rather than
          stored as zero. See a student's{' '}
          <Link to="/students" className="font-medium text-brand hover:underline">profile cards</Link> for the exact reason
          on each platform.
        </Callout>
      </div>
    </>
  );
}
