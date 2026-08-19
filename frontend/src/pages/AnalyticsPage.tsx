import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { analyticsApi } from '../api/endpoints';
import { errorMessage } from '../api/client';
import { useFilters } from '../hooks/useFilters';
import { useTheme } from '../hooks/useTheme';
import { FilterBar } from '../components/FilterBar';
import { Card, EmptyState, ErrorState, LoadingBlock, PageHeader, StatCard, Tabs } from '../components/ui';
import { CategoryBars, CompositionBar, Heatmap, MultiLineChart, SimpleBarChart } from '../components/charts';
import { difficultyColor } from '../lib/palette';
import { formatDate, num, percent } from '../lib/format';

type TabId = 'topics' | 'difficulty' | 'growth';

export default function AnalyticsPage() {
  const { params } = useFilters();
  const { mode } = useTheme();
  const [tab, setTab] = useState<TabId>('topics');

  const topics = useQuery({ queryKey: ['analytics-topics', params], queryFn: () => analyticsApi.topics(params) });
  const difficulty = useQuery({ queryKey: ['analytics-difficulty', params], queryFn: () => analyticsApi.difficulty(params) });
  const growth = useQuery({ queryKey: ['analytics-growth', params], queryFn: () => analyticsApi.growth({ ...params, days: 180 }) });

  return (
    <>
      <PageHeader title="Analytics" subtitle="Topic, difficulty and growth analysis across the filtered cohort." />
      <FilterBar />

      <Card>
        <Tabs<TabId>
          active={tab}
          onChange={setTab}
          tabs={[
            { id: 'topics', label: 'Topics', count: topics.data?.topics.length },
            { id: 'difficulty', label: 'Difficulty' },
            { id: 'growth', label: 'Growth' },
          ]}
        />

        <div className="p-5">
          {tab === 'topics' && (
            topics.isLoading ? <LoadingBlock rows={8} />
            : topics.isError ? <ErrorState message={errorMessage(topics.error)} onRetry={() => topics.refetch()} />
            : (topics.data?.topics.length ?? 0) === 0 ? (
              <EmptyState title="No topic data yet" description="Topic breakdowns appear once profiles have been fetched. CodeChef does not publish them at all." />
            ) : (
              <div className="space-y-8">
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                  <StatCard label="Distinct topics" value={num(topics.data!.topics.length)} />
                  <StatCard label="Topic-tagged solves" value={num(topics.data!.totalSolved)} />
                  <StatCard label="Strongest" value={topics.data!.topics[0]?.topic ?? '—'} hint={topics.data!.topics[0] ? `${num(topics.data!.topics[0].problemsSolved)} solved` : undefined} />
                  <StatCard label="Weakest tracked" value={topics.data!.topics.at(-1)?.topic ?? '—'} hint={topics.data!.topics.at(-1) ? `${num(topics.data!.topics.at(-1)!.problemsSolved)} solved` : undefined} />
                </div>

                <div className="grid gap-8 xl:grid-cols-2">
                  <div>
                    <h3 className="mb-3 text-sm font-semibold text-ink">Problems solved by topic</h3>
                    <CategoryBars data={topics.data!.topics.slice(0, 20).map((t) => ({ label: t.topic, value: t.problemsSolved }))} />
                  </div>
                  <div>
                    <h3 className="mb-1 text-sm font-semibold text-ink">Topic × platform heatmap</h3>
                    <p className="mb-3 text-xs text-ink-muted">Darker means more problems solved. Every cell shows its number, so the colour is never the only signal.</p>
                    <Heatmap
                      rowLabels={topics.data!.topics.slice(0, 16).map((t) => t.topic)}
                      columnLabels={topics.data!.heatmap.map((h) => h.label)}
                      values={topics.data!.topics.slice(0, 16).map((topic) =>
                        topics.data!.heatmap.map((platform) => {
                          const match = platform.topics.find((t) => t.topic === topic.topic);
                          return match ? match.problemsSolved : null;
                        }),
                      )}
                    />
                  </div>
                </div>

                <div>
                  <h3 className="mb-3 text-sm font-semibold text-ink">Topic table</h3>
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr><th>Topic</th><th className="text-right">Problems solved</th><th className="text-right">Students</th><th className="text-right">Share</th></tr>
                      </thead>
                      <tbody>
                        {topics.data!.topics.map((topic) => (
                          <tr key={topic.topic}>
                            <td className="font-medium">{topic.topic}</td>
                            <td className="tabular text-right">{num(topic.problemsSolved)}</td>
                            <td className="tabular text-right">{num(topic.studentCount)}</td>
                            <td className="tabular text-right text-ink-muted">{percent(topic.share)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )
          )}

          {tab === 'difficulty' && (
            difficulty.isLoading ? <LoadingBlock rows={6} />
            : difficulty.isError ? <ErrorState message={errorMessage(difficulty.error)} onRetry={() => difficulty.refetch()} />
            : (
              <div className="space-y-8">
                <div>
                  <h3 className="mb-3 text-sm font-semibold text-ink">Overall difficulty split</h3>
                  <CompositionBar
                    segments={[
                      { label: 'Easy', value: difficulty.data!.difficulty.easy, color: difficultyColor('EASY', mode) },
                      { label: 'Medium', value: difficulty.data!.difficulty.medium, color: difficultyColor('MEDIUM', mode) },
                      { label: 'Hard', value: difficulty.data!.difficulty.hard, color: difficultyColor('HARD', mode) },
                      { label: 'Unclassified', value: difficulty.data!.difficulty.unclassified, color: difficultyColor('UNCLASSIFIED', mode) },
                    ]}
                  />
                </div>

                <div>
                  <h3 className="mb-3 text-sm font-semibold text-ink">Problems solved by platform</h3>
                  <SimpleBarChart
                    data={difficulty.data!.byPlatform.map((platform) => ({
                      label: platform.label,
                      value: platform.totalSolved ?? 0,
                      color: platform.color,
                    }))}
                    valueLabel="Problems solved"
                  />
                </div>

                <div>
                  <h3 className="mb-3 text-sm font-semibold text-ink">Difficulty availability by platform</h3>
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Platform</th><th className="text-right">Students</th><th className="text-right">Solved</th>
                          <th className="text-right">Easy</th><th className="text-right">Medium</th><th className="text-right">Hard</th>
                        </tr>
                      </thead>
                      <tbody>
                        {difficulty.data!.byPlatform.map((platform) => (
                          <tr key={platform.platform}>
                            <td>
                              <span className="flex items-center gap-2 font-medium">
                                <span className="h-2.5 w-2.5 rounded-full" style={{ background: platform.color }} aria-hidden />
                                {platform.label}
                              </span>
                              {!platform.supportsDifficulty && (
                                <span className="mt-0.5 block text-2xs text-ink-subtle">Does not publish a difficulty split</span>
                              )}
                            </td>
                            <td className="tabular text-right">{num(platform.studentsWithData)}</td>
                            <td className="tabular text-right">{num(platform.totalSolved)}</td>
                            {([platform.easySolved, platform.mediumSolved, platform.hardSolved] as (number | null)[]).map((value, i) => (
                              <td key={i} className="tabular text-right">
                                {value === null ? <span className="text-ink-subtle" title="Not published by this platform">N/A</span> : num(value)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )
          )}

          {tab === 'growth' && (
            growth.isLoading ? <LoadingBlock rows={6} />
            : (growth.data?.length ?? 0) < 2 ? (
              <EmptyState title="Not enough history" description="Growth charts need at least two days of snapshots. Snapshots are captured on every refresh." />
            ) : (
              <div className="grid gap-8 lg:grid-cols-2">
                <div>
                  <h3 className="mb-3 text-sm font-semibold text-ink">Average problems solved</h3>
                  <MultiLineChart
                    height={260}
                    series={[{ key: 'solved', label: 'Average solved', color: 'rgb(37 99 235)', points: growth.data!.map((p) => ({ x: p.date, y: p.averageSolved })) }]}
                    xLabelFormatter={(v) => formatDate(String(v))}
                  />
                </div>
                <div>
                  <h3 className="mb-3 text-sm font-semibold text-ink">Average CP score</h3>
                  <MultiLineChart
                    height={260}
                    series={[{ key: 'score', label: 'Average CP score', color: 'rgb(22 163 74)', points: growth.data!.map((p) => ({ x: p.date, y: p.averageScore })) }]}
                    xLabelFormatter={(v) => formatDate(String(v))}
                  />
                </div>
                <div>
                  <h3 className="mb-3 text-sm font-semibold text-ink">Average contest rating</h3>
                  <MultiLineChart
                    height={260}
                    series={[{ key: 'rating', label: 'Average rating', color: 'rgb(217 119 6)', points: growth.data!.map((p) => ({ x: p.date, y: p.averageRating })) }]}
                    xLabelFormatter={(v) => formatDate(String(v))}
                  />
                </div>
                <div>
                  <h3 className="mb-3 text-sm font-semibold text-ink">Students with a snapshot</h3>
                  <MultiLineChart
                    height={260}
                    series={[{ key: 'students', label: 'Students', color: 'rgb(147 51 234)', points: growth.data!.map((p) => ({ x: p.date, y: p.students })) }]}
                    xLabelFormatter={(v) => formatDate(String(v))}
                  />
                </div>
              </div>
            )
          )}
        </div>
      </Card>
    </>
  );
}
