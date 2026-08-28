import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Save } from 'lucide-react';
import { analyticsApi, settingsApi } from '../api/endpoints';
import { errorMessage } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { Callout, Card, LoadingBlock, PageHeader, Spinner, Tabs, useToast } from '../components/ui';
import { AutomationSettings } from '../components/AutomationSettings';
import { ShareLinksSettings } from '../components/ShareLinksSettings';
import { num } from '../lib/format';
import type { Platform } from '../types/api';

type TabId = 'scoring' | 'skills' | 'processing' | 'automation' | 'links' | 'appearance';

export default function SettingsPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<TabId>('scoring');
  const settings = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get });

  if (settings.isLoading) return <LoadingBlock rows={8} />;

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Scoring weights, skill thresholds, processing limits and platform colours."
      />

      {!can('ADMIN') && (
        <div className="mb-5">
          <Callout tone="info">You can view these settings, but only an administrator can change them.</Callout>
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <RuntimeTile label="Data source" value={settings.data!.runtime.dataSource} hint={settings.data!.runtime.dataSource === 'mock' ? 'Sample responses only' : 'Live platform calls'} />
        <RuntimeTile label="Queue driver" value={settings.data!.runtime.queueDriver} />
        <RuntimeTile label="Max upload size" value={`${settings.data!.runtime.maxUploadMb} MB`} />
        <RuntimeTile label="Max rows per file" value={num(settings.data!.runtime.maxUploadRows)} />
      </div>

      <Card>
        <Tabs<TabId>
          active={tab}
          onChange={setTab}
          tabs={[
            { id: 'scoring', label: 'Scoring' },
            { id: 'skills', label: 'Skill levels' },
            { id: 'processing', label: 'Processing' },
            { id: 'automation', label: 'Automation' },
            { id: 'links', label: 'Student links' },
            { id: 'appearance', label: 'Appearance' },
          ]}
        />
        <div className="p-5">
          {tab === 'scoring' && <ScoringSettings settings={settings.data!} editable={can('ADMIN')} />}
          {tab === 'skills' && <SkillSettings settings={settings.data!} editable={can('ADMIN')} />}
          {tab === 'processing' && <ProcessingSettings settings={settings.data!} editable={can('ADMIN')} />}
          {tab === 'automation' && <AutomationSettings settings={settings.data!} editable={can('ADMIN')} />}
          {tab === 'links' && <ShareLinksSettings editable={can('TRAINER')} />}
          {tab === 'appearance' && <AppearanceSettings settings={settings.data!} editable={can('ADMIN')} />}
        </div>
      </Card>
    </>
  );
}

function RuntimeTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="mt-1.5 text-base font-semibold text-ink">{value}</p>
      {hint && <p className="mt-0.5 text-2xs text-ink-subtle">{hint}</p>}
    </div>
  );
}

/**
 * Shared save/reset behaviour for one settings key.
 *
 * Both paths ask for a recompute by default; the server ignores the request for
 * keys that do not affect scoring. Saving and resetting must behave the same,
 * or a reset leaves every stored score computed under the old weights.
 */
function useSettingMutation(key: string, options: { recompute?: boolean } = {}) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const recompute = options.recompute ?? true;

  const save = useMutation({
    mutationFn: (value: Record<string, unknown>) => settingsApi.update(key, value, recompute),
    onSuccess: (result) => {
      notify(
        result.recomputed !== undefined
          ? `Saved. Recalculated ${result.recomputed} students.`
          : 'Settings saved.',
        'success',
      );
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      queryClient.invalidateQueries({ queryKey: ['leaderboard'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
    },
    onError: (error) => notify(errorMessage(error), 'error'),
  });

  const reset = useMutation({
    // A reset shifts every score just as an edit does, so it recomputes too.
    mutationFn: () => settingsApi.reset(key, recompute),
    onSuccess: (result) => {
      notify(
        result.recomputed !== undefined
          ? `Reset to defaults. Recalculated ${result.recomputed} students.`
          : 'Reset to defaults.',
        'success',
      );
      queryClient.invalidateQueries();
    },
    onError: (error) => notify(errorMessage(error), 'error'),
  });

  return { save, reset };
}

function NumberField({
  label,
  hint,
  value,
  onChange,
  disabled,
  min,
  max,
  step,
  suffix,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <span className="flex items-center gap-2">
        <input
          type="number"
          className="input"
          value={value}
          min={min}
          max={max}
          step={step ?? 1}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        {suffix && <span className="shrink-0 text-xs text-ink-muted">{suffix}</span>}
      </span>
      {hint && <span className="mt-1 block text-2xs text-ink-subtle">{hint}</span>}
    </label>
  );
}

function ScoringSettings({ settings, editable }: { settings: Awaited<ReturnType<typeof settingsApi.get>>; editable: boolean }) {
  const weightsKey = 'scoring.weights';
  const targetsKey = 'scoring.targets';
  const weightsMutation = useSettingMutation(weightsKey, { recompute: true });
  const targetsMutation = useSettingMutation(targetsKey, { recompute: true });

  const [weights, setWeights] = useState<Record<string, number>>(settings.data[weightsKey] as Record<string, number>);
  const [targets, setTargets] = useState<Record<string, number>>(settings.data[targetsKey] as Record<string, number>);

  useEffect(() => setWeights(settings.data[weightsKey] as Record<string, number>), [settings]);
  useEffect(() => setTargets(settings.data[targetsKey] as Record<string, number>), [settings]);

  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);

  const WEIGHT_FIELDS = [
    ['problemsSolved', 'Problems solved'],
    ['problemDifficulty', 'Problem difficulty'],
    ['contestParticipation', 'Contest participation'],
    ['contestRating', 'Contest rating'],
    ['topicCoverage', 'Topic coverage'],
  ] as const;

  const TARGET_FIELDS = [
    ['problemsSolvedTarget', 'Problems solved for full marks', 'Solving this many earns 100% on the problems component.'],
    ['difficultyPointsTarget', 'Difficulty points for full marks', 'Easy counts 1, Medium 3, Hard 6 by default.'],
    ['contestsTarget', 'Contests for full marks', ''],
    ['ratingTarget', 'Rating for full marks', 'Measured above an 800 floor, since ratings start there.'],
    ['topicsTarget', 'Distinct topics for full marks', ''],
  ] as const;

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-ink">Score weights</h3>
            <p className="mt-0.5 text-xs text-ink-muted">
              Relative importance of each component. They do not have to add up to 100 — they are normalized.
            </p>
          </div>
          <span className={`badge ${Math.abs(total - 100) < 0.01 ? 'bg-positive/10 text-positive' : 'bg-caution/10 text-caution'}`}>
            Total: {total}
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {WEIGHT_FIELDS.map(([key, label]) => (
            <NumberField
              key={key}
              label={label}
              value={weights[key] ?? 0}
              disabled={!editable}
              min={0}
              max={100}
              suffix="%"
              onChange={(value) => setWeights({ ...weights, [key]: value })}
            />
          ))}
        </div>

        {editable && (
          <div className="mt-4 flex gap-2">
            <button type="button" className="btn-primary" disabled={weightsMutation.save.isPending} onClick={() => weightsMutation.save.mutate(weights)}>
              {weightsMutation.save.isPending ? <Spinner /> : <Save className="h-4 w-4" />}
              Save and recalculate
            </button>
            <button type="button" className="btn-ghost" onClick={() => weightsMutation.reset.mutate()}>
              <RotateCcw className="h-4 w-4" />
              Reset
            </button>
          </div>
        )}
      </section>

      <section className="border-t border-line pt-6">
        <h3 className="text-sm font-semibold text-ink">Score targets</h3>
        <p className="mb-3 mt-0.5 text-xs text-ink-muted">
          The level at which each component saturates at 100%. Lower targets make scores rise faster.
        </p>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TARGET_FIELDS.map(([key, label, hint]) => (
            <NumberField
              key={key}
              label={label}
              hint={hint || undefined}
              value={targets[key] ?? 0}
              disabled={!editable}
              min={1}
              onChange={(value) => setTargets({ ...targets, [key]: value })}
            />
          ))}
        </div>

        {editable && (
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              className="btn-primary"
              disabled={targetsMutation.save.isPending}
              onClick={() => targetsMutation.save.mutate(targets)}
            >
              {targetsMutation.save.isPending ? <Spinner /> : <Save className="h-4 w-4" />}
              Save and recalculate
            </button>
            <button type="button" className="btn-ghost" onClick={() => targetsMutation.reset.mutate()}>
              <RotateCcw className="h-4 w-4" />
              Reset
            </button>
          </div>
        )}
      </section>

      <Callout tone="info" title="The score is ours, not the platforms'">
        The Competitive Programming Score is a composite this application computes from public data. It is always labelled as
        such in the UI and in exported reports, and every student's page shows the full calculation.
      </Callout>
    </div>
  );
}

function SkillSettings({ settings, editable }: { settings: Awaited<ReturnType<typeof settingsApi.get>>; editable: boolean }) {
  const key = 'skills.thresholds';
  const { save, reset } = useSettingMutation(key);
  const [values, setValues] = useState<Record<string, number>>(settings.data[key] as Record<string, number>);
  useEffect(() => setValues(settings.data[key] as Record<string, number>), [settings]);

  const FIELDS = [
    ['beginner', 'Beginner from', 'Weighted problems solved needed to reach this level.'],
    ['intermediate', 'Intermediate from', ''],
    ['advanced', 'Advanced from', ''],
    ['expert', 'Expert from', ''],
  ] as const;

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-semibold text-ink">Skill level thresholds</h3>
        <p className="mb-3 mt-0.5 text-xs text-ink-muted">
          A topic's weighted score is its solved count, boosted for platform breadth and recent activity.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FIELDS.map(([field, label, hint]) => (
            <NumberField
              key={field}
              label={label}
              hint={hint || undefined}
              value={values[field] ?? 0}
              disabled={!editable}
              min={0}
              onChange={(value) => setValues({ ...values, [field]: value })}
            />
          ))}
        </div>
      </section>

      <section className="border-t border-line pt-6">
        <h3 className="text-sm font-semibold text-ink">Bonuses</h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <NumberField
            label="Platform diversity bonus"
            hint="Added per extra platform the topic appears on (0.15 = +15%)."
            value={values.platformDiversityBonus ?? 0}
            disabled={!editable}
            min={0} max={2} step={0.05}
            onChange={(value) => setValues({ ...values, platformDiversityBonus: value })}
          />
          <NumberField
            label="Recent activity bonus"
            hint="Applied when the topic was practised inside the window below."
            value={values.recentActivityBonus ?? 0}
            disabled={!editable}
            min={0} max={2} step={0.05}
            onChange={(value) => setValues({ ...values, recentActivityBonus: value })}
          />
          <NumberField
            label="Recent activity window"
            suffix="days"
            value={values.recentActivityWindowDays ?? 30}
            disabled={!editable}
            min={1} max={365}
            onChange={(value) => setValues({ ...values, recentActivityWindowDays: value })}
          />
        </div>
      </section>

      {editable && (
        <div className="flex gap-2">
          <button type="button" className="btn-primary" disabled={save.isPending} onClick={() => save.mutate(values)}>
            {save.isPending ? <Spinner /> : <Save className="h-4 w-4" />}
            Save
          </button>
          <button type="button" className="btn-ghost" onClick={() => reset.mutate()}>
            <RotateCcw className="h-4 w-4" />
            Reset
          </button>
          <RecomputeButton />
        </div>
      )}
    </div>
  );
}

function ProcessingSettings({ settings, editable }: { settings: Awaited<ReturnType<typeof settingsApi.get>>; editable: boolean }) {
  const limitsKey = 'processing.limits';
  const cacheKey = 'cache.settings';
  const limitsMutation = useSettingMutation(limitsKey);
  const cacheMutation = useSettingMutation(cacheKey);

  const [limits, setLimits] = useState<Record<string, never>>(settings.data[limitsKey] as never);
  const [cache, setCache] = useState<Record<string, number>>(settings.data[cacheKey] as Record<string, number>);
  useEffect(() => setLimits(settings.data[limitsKey] as never), [settings]);
  useEffect(() => setCache(settings.data[cacheKey] as Record<string, number>), [settings]);

  const rates = (limits.perPlatformRatePerMinute ?? {}) as unknown as Record<Platform, number>;

  return (
    <div className="space-y-8">
      <section>
        <h3 className="text-sm font-semibold text-ink">Rate limits</h3>
        <p className="mb-3 mt-0.5 text-xs text-ink-muted">
          Requests per minute per platform. Lower values are gentler on the platform and reduce the chance of being throttled.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(Object.keys(rates) as Platform[]).map((platform) => (
            <NumberField
              key={platform}
              label={platform}
              suffix="req/min"
              value={rates[platform] ?? 10}
              disabled={!editable}
              min={1} max={600}
              onChange={(value) =>
                setLimits({ ...limits, perPlatformRatePerMinute: { ...rates, [platform]: value } } as never)
              }
            />
          ))}
        </div>
      </section>

      <section className="border-t border-line pt-6">
        <h3 className="text-sm font-semibold text-ink">Retries and timeouts</h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <NumberField label="Worker concurrency" value={(limits.concurrency as unknown as number) ?? 4} disabled={!editable} min={1} max={64} onChange={(v) => setLimits({ ...limits, concurrency: v } as never)} />
          <NumberField label="Max retries" value={(limits.maxRetries as unknown as number) ?? 3} disabled={!editable} min={0} max={10} onChange={(v) => setLimits({ ...limits, maxRetries: v } as never)} />
          <NumberField label="Backoff base" suffix="ms" hint="Doubles each attempt, with jitter." value={(limits.retryBaseDelayMs as unknown as number) ?? 1000} disabled={!editable} min={100} max={60000} step={100} onChange={(v) => setLimits({ ...limits, retryBaseDelayMs: v } as never)} />
          <NumberField label="Request timeout" suffix="ms" value={(limits.requestTimeoutMs as unknown as number) ?? 15000} disabled={!editable} min={1000} max={120000} step={1000} onChange={(v) => setLimits({ ...limits, requestTimeoutMs: v } as never)} />
        </div>
        {editable && (
          <div className="mt-4 flex gap-2">
            <button type="button" className="btn-primary" disabled={limitsMutation.save.isPending} onClick={() => limitsMutation.save.mutate(limits)}>
              {limitsMutation.save.isPending ? <Spinner /> : <Save className="h-4 w-4" />}
              Save
            </button>
            <button type="button" className="btn-ghost" onClick={() => limitsMutation.reset.mutate()}>
              <RotateCcw className="h-4 w-4" />
              Reset
            </button>
          </div>
        )}
      </section>

      <section className="border-t border-line pt-6">
        <h3 className="text-sm font-semibold text-ink">Cache</h3>
        <p className="mb-3 mt-0.5 text-xs text-ink-muted">
          A profile fetched inside this window is skipped on the next refresh unless the refresh is forced.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <NumberField label="Fresh data lasts" suffix="minutes" value={cache.ttlMinutes ?? 720} disabled={!editable} min={0} max={43200} onChange={(v) => setCache({ ...cache, ttlMinutes: v })} />
          <NumberField label="Failed fetch retried after" suffix="minutes" hint="Shorter, so a transient error clears quickly." value={cache.errorTtlMinutes ?? 30} disabled={!editable} min={0} max={43200} onChange={(v) => setCache({ ...cache, errorTtlMinutes: v })} />
        </div>
        {editable && (
          <div className="mt-4 flex gap-2">
            <button type="button" className="btn-primary" disabled={cacheMutation.save.isPending} onClick={() => cacheMutation.save.mutate(cache)}>
              {cacheMutation.save.isPending ? <Spinner /> : <Save className="h-4 w-4" />}
              Save
            </button>
            <button type="button" className="btn-ghost" onClick={() => cacheMutation.reset.mutate()}>
              <RotateCcw className="h-4 w-4" />
              Reset
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function AppearanceSettings({ settings, editable }: { settings: Awaited<ReturnType<typeof settingsApi.get>>; editable: boolean }) {
  const key = 'ui.platformColors';
  const { save, reset } = useSettingMutation(key);
  type ThemedColors = Record<Platform, { light: string; dark: string }>;
  const [colors, setColors] = useState<ThemedColors>(settings.data[key] as unknown as ThemedColors);
  useEffect(() => setColors(settings.data[key] as unknown as ThemedColors), [settings]);

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-semibold text-ink">Platform colours</h3>
        <p className="mb-4 mt-0.5 text-xs text-ink-muted">
          Used consistently in every chart, badge and report. One step per theme, because a colour that reads well on white
          is usually too dark on a dark background.
        </p>

        <div className="space-y-3">
          {(Object.keys(colors) as Platform[]).map((platform) => (
            <div key={platform} className="flex flex-wrap items-center gap-4">
              <span className="w-28 text-sm font-medium text-ink">{platform}</span>
              {(['light', 'dark'] as const).map((theme) => (
                <label key={theme} className="flex items-center gap-2">
                  <span className="w-10 text-xs text-ink-muted">{theme}</span>
                  <input
                    type="color"
                    className="h-8 w-12 cursor-pointer rounded border border-line bg-transparent disabled:cursor-not-allowed"
                    value={colors[platform]?.[theme] ?? '#2A78D6'}
                    disabled={!editable}
                    onChange={(event) =>
                      setColors({ ...colors, [platform]: { ...colors[platform], [theme]: event.target.value.toUpperCase() } })
                    }
                  />
                  <code className="text-2xs text-ink-subtle">{colors[platform]?.[theme]}</code>
                </label>
              ))}
            </div>
          ))}
        </div>

        <div className="mt-5">
          <Callout tone="warning" title="Defaults are accessibility-checked, not brand-exact">
            The shipped colours are re-stepped versions of each platform's brand hue. The marketing colours themselves fail
            contrast and colour-blind separation as a chart palette. If you replace them, verify the new values stay
            distinguishable in both themes.
          </Callout>
        </div>

        {editable && (
          <div className="mt-4 flex gap-2">
            <button type="button" className="btn-primary" disabled={save.isPending} onClick={() => save.mutate(colors)}>
              {save.isPending ? <Spinner /> : <Save className="h-4 w-4" />}
              Save
            </button>
            <button type="button" className="btn-ghost" onClick={() => reset.mutate()}>
              <RotateCcw className="h-4 w-4" />
              Reset to defaults
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function RecomputeButton() {
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const recompute = useMutation({
    mutationFn: analyticsApi.recompute,
    onSuccess: (result) => {
      notify(result.message, 'success');
      queryClient.invalidateQueries();
    },
    onError: (error) => notify(errorMessage(error), 'error'),
  });

  return (
    <button type="button" className="btn-secondary" disabled={recompute.isPending} onClick={() => recompute.mutate()}>
      {recompute.isPending ? <Spinner /> : <RotateCcw className="h-4 w-4" />}
      Recalculate all students
    </button>
  );
}
