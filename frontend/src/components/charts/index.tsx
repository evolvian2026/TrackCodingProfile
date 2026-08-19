import { useMemo, type ReactNode } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis, type TooltipProps,
} from 'recharts';
import clsx from 'clsx';
import { useTheme } from '../../hooks/useTheme';
import { sequentialColor } from '../../lib/palette';
import { num } from '../../lib/format';
import { EmptyState } from '../ui';

/** Recharts needs concrete colours, so axis/grid ink is read from the theme. */
function useChartInk() {
  const { mode } = useTheme();
  return useMemo(
    () =>
      mode === 'dark'
        ? { axis: '#94A3B8', grid: '#334155', surface: '#1E293B', text: '#F1F5F9', border: '#334155' }
        : { axis: '#64748B', grid: '#E2E8F0', surface: '#FFFFFF', text: '#0F172A', border: '#E2E8F0' },
    [mode],
  );
}

interface TooltipRow {
  label: string;
  value: ReactNode;
  color?: string;
}

function TooltipShell({ title, rows }: { title: ReactNode; rows: TooltipRow[] }) {
  const ink = useChartInk();
  return (
    <div
      className="rounded-lg border px-3 py-2 text-xs shadow-pop"
      style={{ background: ink.surface, borderColor: ink.border, color: ink.text }}
    >
      <p className="mb-1 font-medium">{title}</p>
      <div className="space-y-0.5">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5" style={{ color: ink.axis }}>
              {row.color && <span className="h-2 w-2 rounded-full" style={{ background: row.color }} />}
              {row.label}
            </span>
            <span className="tabular font-medium">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ChartFrame({
  height = 260,
  children,
  empty,
}: {
  height?: number;
  children: ReactNode;
  empty?: { title: string; description?: string } | null;
}) {
  if (empty) {
    return (
      <div style={{ height }} className="flex items-center justify-center">
        <EmptyState title={empty.title} description={empty.description} />
      </div>
    );
  }
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        {children as never}
      </ResponsiveContainer>
    </div>
  );
}

// -- horizontal category bars ------------------------------------------------

export interface CategoryBar {
  label: string;
  value: number | null;
  color?: string;
  /** Shown in the tooltip when a value is absent, e.g. why it is N/A. */
  note?: string;
}

/**
 * Horizontal bars for ranked magnitudes (topics, platforms, colleges).
 * Values are direct-labeled, which is also the secondary encoding that keeps
 * identity off colour alone.
 */
export function CategoryBars({
  data,
  height,
  valueLabel = 'Problems solved',
  maxItems,
}: {
  data: CategoryBar[];
  height?: number;
  valueLabel?: string;
  maxItems?: number;
}) {
  const rows = (maxItems ? data.slice(0, maxItems) : data).filter((d) => d.value !== null);
  const max = Math.max(1, ...rows.map((d) => d.value ?? 0));

  if (rows.length === 0) {
    return <EmptyState title="Nothing to chart yet" description="No platform published a value for this view." />;
  }

  return (
    <ul className="space-y-2.5" style={height ? { maxHeight: height, overflowY: 'auto' } : undefined}>
      {rows.map((row) => (
        <li key={row.label} className="grid grid-cols-[minmax(6.5rem,9rem)_1fr_auto] items-center gap-3">
          <span className="truncate text-xs text-ink-muted" title={row.label}>
            {row.label}
          </span>
          <span className="h-2.5 overflow-hidden rounded-full bg-surface-muted" title={`${row.label}: ${num(row.value)} ${valueLabel.toLowerCase()}`}>
            <span
              className="block h-full rounded-full transition-[width] duration-500"
              style={{ width: `${Math.max(1.5, ((row.value ?? 0) / max) * 100)}%`, background: row.color ?? 'rgb(var(--brand))' }}
            />
          </span>
          <span className="tabular w-14 text-right text-xs font-medium text-ink">{num(row.value)}</span>
        </li>
      ))}
    </ul>
  );
}

// -- vertical bars -----------------------------------------------------------

export function SimpleBarChart({
  data,
  height = 260,
  valueLabel = 'Value',
  formatValue = (v: number) => num(v),
}: {
  data: { label: string; value: number; color?: string }[];
  height?: number;
  valueLabel?: string;
  formatValue?: (value: number) => string;
}) {
  const ink = useChartInk();

  if (data.length === 0) {
    return <ChartFrame height={height} empty={{ title: 'Nothing to chart yet' }}>{<div />}</ChartFrame>;
  }

  return (
    <ChartFrame height={height}>
      <BarChart data={data} margin={{ top: 12, right: 8, bottom: 4, left: 0 }}>
        <CartesianGrid stroke={ink.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={{ fill: ink.axis, fontSize: 11 }} axisLine={{ stroke: ink.grid }} tickLine={false} />
        <YAxis tick={{ fill: ink.axis, fontSize: 11 }} axisLine={false} tickLine={false} width={44} />
        <Tooltip
          cursor={{ fill: ink.grid, fillOpacity: 0.3 }}
          content={({ active, payload, label }: TooltipProps<number, string>) =>
            active && payload?.length ? (
              <TooltipShell
                title={label as string}
                rows={[{ label: valueLabel, value: formatValue(payload[0]!.value as number), color: payload[0]!.payload.color }]}
              />
            ) : null
          }
        />
        <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={56}>
          {data.map((entry, index) => (
            <Cell key={index} fill={entry.color ?? 'rgb(37 99 235)'} />
          ))}
        </Bar>
      </BarChart>
    </ChartFrame>
  );
}

// -- multi-series line -------------------------------------------------------

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  points: { x: string | number; y: number | null }[];
}

/**
 * Multi-series line on ONE y-axis. Two measures of different scale are never
 * put on a second axis — they get separate charts instead.
 */
export function MultiLineChart({
  series,
  height = 280,
  xLabelFormatter = (value: string | number) => String(value),
  valueFormatter = (value: number) => num(value),
  yLabel,
}: {
  series: LineSeries[];
  height?: number;
  xLabelFormatter?: (value: string | number) => string;
  valueFormatter?: (value: number) => string;
  yLabel?: string;
}) {
  const ink = useChartInk();

  // Merge the series onto a shared x-domain so gaps stay gaps.
  const merged = useMemo(() => {
    const byX = new Map<string | number, Record<string, string | number | null>>();
    for (const s of series) {
      for (const point of s.points) {
        const row = byX.get(point.x) ?? { x: point.x };
        row[s.key] = point.y;
        byX.set(point.x, row);
      }
    }
    return [...byX.values()].sort((a, b) => String(a.x).localeCompare(String(b.x)));
  }, [series]);

  if (merged.length === 0) {
    return <ChartFrame height={height} empty={{ title: 'No history yet', description: 'Data points appear as profiles are refreshed over time.' }}>{<div />}</ChartFrame>;
  }

  return (
    <ChartFrame height={height}>
      <LineChart data={merged} margin={{ top: 12, right: 12, bottom: 4, left: 0 }}>
        <CartesianGrid stroke={ink.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="x"
          tick={{ fill: ink.axis, fontSize: 11 }}
          axisLine={{ stroke: ink.grid }}
          tickLine={false}
          tickFormatter={xLabelFormatter as never}
          minTickGap={28}
        />
        <YAxis
          tick={{ fill: ink.axis, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={48}
          domain={['auto', 'auto']}
          label={yLabel ? { value: yLabel, angle: -90, position: 'insideLeft', fill: ink.axis, fontSize: 11 } : undefined}
        />
        <Tooltip
          cursor={{ stroke: ink.axis, strokeDasharray: '3 3' }}
          content={({ active, payload, label }: TooltipProps<number, string>) =>
            active && payload?.length ? (
              <TooltipShell
                title={xLabelFormatter(label as string)}
                rows={payload
                  .filter((entry) => entry.value !== null && entry.value !== undefined)
                  .map((entry) => ({
                    label: series.find((s) => s.key === entry.dataKey)?.label ?? String(entry.dataKey),
                    value: valueFormatter(entry.value as number),
                    color: entry.color,
                  }))}
              />
            ) : null
          }
        />
        {series.length > 1 && (
          <Legend
            verticalAlign="top"
            align="right"
            height={28}
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 11, color: ink.axis }}
          />
        )}
        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color}
            strokeWidth={2}
            dot={{ r: 2.5, strokeWidth: 0, fill: s.color }}
            activeDot={{ r: 5, strokeWidth: 2, stroke: ink.surface }}
            connectNulls={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ChartFrame>
  );
}

// -- heatmap -----------------------------------------------------------------

/**
 * Topic × platform heatmap on a single-hue sequential ramp (light = low).
 * Every cell carries its number, so magnitude never depends on colour alone.
 */
export function Heatmap({
  rowLabels,
  columnLabels,
  values,
  valueLabel = 'solved',
}: {
  rowLabels: string[];
  columnLabels: string[];
  /** values[rowIndex][columnIndex]; null renders as an explicit blank. */
  values: (number | null)[][];
  valueLabel?: string;
}) {
  const { mode } = useTheme();
  const max = Math.max(1, ...values.flat().map((v) => v ?? 0));

  if (rowLabels.length === 0) {
    return <EmptyState title="No topic data yet" description="Topic breakdowns appear once profiles have been fetched." />;
  }

  return (
    <div className="table-wrap">
      <table className="w-full border-separate border-spacing-0.5 text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-surface-raised px-2 py-1.5 text-left font-medium text-ink-muted">Topic</th>
            {columnLabels.map((column) => (
              <th key={column} className="px-2 py-1.5 text-center font-medium text-ink-muted">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rowLabels.map((row, rowIndex) => (
            <tr key={row}>
              <td className="sticky left-0 z-10 max-w-[10rem] truncate bg-surface-raised px-2 py-1 text-ink" title={row}>
                {row}
              </td>
              {columnLabels.map((column, columnIndex) => {
                const value = values[rowIndex]?.[columnIndex] ?? null;
                if (value === null) {
                  return (
                    <td key={column} className="px-2 py-1 text-center text-ink-subtle" title={`${row} · ${column}: not published`}>
                      –
                    </td>
                  );
                }
                const fraction = value / max;
                const background = sequentialColor(fraction, mode);
                // Keep label contrast on the darker end of the ramp.
                const text = fraction > 0.55 ? '#FFFFFF' : mode === 'dark' ? '#E2E8F0' : '#0F172A';
                return (
                  <td
                    key={column}
                    className="tabular rounded px-2 py-1 text-center font-medium"
                    style={{ background, color: text }}
                    title={`${row} · ${column}: ${num(value)} ${valueLabel}`}
                  >
                    {num(value)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// -- stacked composition bar -------------------------------------------------

/**
 * A single horizontal bar broken into parts (difficulty split). Segments are
 * separated by a 2px surface gap and every segment is named in the legend.
 */
export function CompositionBar({
  segments,
  total,
}: {
  segments: { label: string; value: number; color: string }[];
  total?: number;
}) {
  const sum = total ?? segments.reduce((acc, s) => acc + s.value, 0);
  if (sum <= 0) {
    return <EmptyState title="No difficulty data" description="No platform published a difficulty breakdown for this selection." />;
  }

  return (
    <div>
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-surface-muted">
        {segments
          .filter((s) => s.value > 0)
          .map((segment) => (
            <span
              key={segment.label}
              className="h-full first:rounded-l-full last:rounded-r-full"
              style={{ width: `${(segment.value / sum) * 100}%`, background: segment.color }}
              title={`${segment.label}: ${num(segment.value)} (${((segment.value / sum) * 100).toFixed(1)}%)`}
            />
          ))}
      </div>
      {/* Wraps rather than forcing fixed columns — a narrow card would otherwise
          clip "Unclassified" down to "U.". */}
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
        {segments.map((segment) => (
          <li key={segment.label} className="flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: segment.color }} />
            <span className="text-ink-muted">{segment.label}</span>
            <span className="tabular font-medium text-ink">{num(segment.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// -- score gauge -------------------------------------------------------------

export function ScoreGauge({ score, label = 'CP Score' }: { score: number | null; label?: string }) {
  const { mode } = useTheme();
  const value = score ?? 0;
  const color = sequentialColor(value / 100, mode);
  const circumference = 2 * Math.PI * 42;

  return (
    <div className={clsx('flex items-center gap-4')}>
      <svg width="104" height="104" viewBox="0 0 104 104" role="img" aria-label={`${label}: ${score === null ? 'not available' : `${score} out of 100`}`}>
        <circle cx="52" cy="52" r="42" fill="none" stroke="rgb(var(--surface-muted))" strokeWidth="9" />
        {score !== null && (
          <circle
            cx="52" cy="52" r="42" fill="none" stroke={color} strokeWidth="9" strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - Math.max(0, Math.min(100, value)) / 100)}
            transform="rotate(-90 52 52)"
            style={{ transition: 'stroke-dashoffset 600ms ease' }}
          />
        )}
        <text x="52" y="49" textAnchor="middle" className="tabular fill-ink" style={{ fontSize: 22, fontWeight: 600 }}>
          {score === null ? 'N/A' : score.toFixed(0)}
        </text>
        <text x="52" y="66" textAnchor="middle" className="fill-ink-subtle" style={{ fontSize: 10 }}>
          / 100
        </text>
      </svg>
    </div>
  );
}
