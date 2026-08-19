import clsx from 'clsx';
import { AlertCircle, AlertTriangle, Check, Info, Loader2, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  NOT_AVAILABLE,
  STATUS_PRESENTATION,
  STATUS_TONE_CLASS,
  SKILL_LEVEL_PRESENTATION,
  num,
} from '../lib/format';
import type { DataStatus, SkillLevel } from '../types/api';

// -- layout primitives -------------------------------------------------------

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={clsx('card', className)}>{children}</section>;
}

export function CardHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="card-header">
      <div className="min-w-0">
        <h2 className="card-title truncate">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-ink-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// -- data display ------------------------------------------------------------

/**
 * Renders a metric, or an explicit "N/A" with the reason when the platform did
 * not publish it. This component is the UI half of the data-integrity rule:
 * unknown is never drawn as zero.
 */
export function DataValue({
  value,
  status,
  reason,
  suffix,
  className,
}: {
  value: number | string | null | undefined;
  status?: DataStatus;
  reason?: string | null;
  suffix?: string;
  className?: string;
}) {
  const missing = value === null || value === undefined;
  const explanation = reason ?? (status ? STATUS_PRESENTATION[status].hint : 'This platform does not publish this value.');

  if (missing) {
    return (
      <span className={clsx('text-ink-subtle', className)} title={explanation}>
        {NOT_AVAILABLE}
      </span>
    );
  }

  return (
    <span className={clsx('tabular', className)}>
      {typeof value === 'number' ? num(value) : value}
      {suffix && <span className="ml-0.5 text-ink-muted">{suffix}</span>}
    </span>
  );
}

export function StatCard({
  label,
  value,
  hint,
  accent,
  icon,
  trend,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  accent?: string;
  icon?: ReactNode;
  trend?: { value: number; label?: string };
}) {
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</p>
        {icon && <span className="text-ink-subtle">{icon}</span>}
      </div>
      <p className="tabular mt-2 text-2xl font-semibold" style={accent ? { color: accent } : undefined}>
        {value}
      </p>
      <div className="mt-1 flex items-center gap-2">
        {hint && <p className="text-xs text-ink-muted">{hint}</p>}
        {trend && (
          <span className={clsx('text-xs font-medium', trend.value >= 0 ? 'text-positive' : 'text-negative')}>
            {trend.value >= 0 ? '+' : ''}
            {trend.value}
            {trend.label ? ` ${trend.label}` : ''}
          </span>
        )}
      </div>
    </div>
  );
}

export function StatusBadge({ status, message }: { status: DataStatus; message?: string | null }) {
  const presentation = STATUS_PRESENTATION[status];
  return (
    <span className={clsx('badge', STATUS_TONE_CLASS[presentation.tone])} title={message ?? presentation.hint}>
      {presentation.label}
    </span>
  );
}

export function SkillBadge({ level }: { level: SkillLevel }) {
  const presentation = SKILL_LEVEL_PRESENTATION[level];
  return <span className={clsx('badge', presentation.tone)}>{presentation.label}</span>;
}

export function PlatformDot({ color, label }: { color: string; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />
      {label && <span>{label}</span>}
    </span>
  );
}

export function ProgressBar({
  value,
  max = 100,
  color,
  className,
  showLabel,
}: {
  value: number;
  max?: number;
  color?: string;
  className?: string;
  showLabel?: boolean;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className={clsx('flex items-center gap-2', className)}>
      <div
        className="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%`, backgroundColor: color ?? 'rgb(var(--brand))' }}
        />
      </div>
      {showLabel && <span className="tabular w-12 shrink-0 text-right text-xs text-ink-muted">{pct.toFixed(0)}%</span>}
    </div>
  );
}

// -- states ------------------------------------------------------------------

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('h-4 w-4 animate-spin', className)} aria-hidden />;
}

export function LoadingBlock({ label = 'Loading…', rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div className="p-5" aria-busy="true" aria-label={label}>
      <div className="space-y-2.5">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="h-3 animate-pulse rounded bg-surface-muted" style={{ width: `${100 - i * 12}%` }} />
        ))}
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 text-ink-subtle">{icon ?? <Info className="h-8 w-8" />}</div>
      <p className="text-sm font-medium text-ink">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <AlertCircle className="mb-3 h-8 w-8 text-negative" aria-hidden />
      <p className="text-sm font-medium text-ink">Could not load this section</p>
      <p className="mt-1 max-w-md text-sm text-ink-muted">{message}</p>
      {onRetry && (
        <button type="button" className="btn-secondary mt-4" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Callout({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success';
  title?: string;
  children: ReactNode;
}) {
  const tones = {
    info: { wrap: 'border-brand/30 bg-brand/5 text-ink', icon: <Info className="h-4 w-4 text-brand" /> },
    warning: { wrap: 'border-caution/30 bg-caution/5 text-ink', icon: <AlertTriangle className="h-4 w-4 text-caution" /> },
    danger: { wrap: 'border-negative/30 bg-negative/5 text-ink', icon: <AlertCircle className="h-4 w-4 text-negative" /> },
    success: { wrap: 'border-positive/30 bg-positive/5 text-ink', icon: <Check className="h-4 w-4 text-positive" /> },
  }[tone];

  return (
    <div className={clsx('flex gap-3 rounded-lg border px-4 py-3 text-sm', tones.wrap)}>
      <span className="mt-0.5 shrink-0">{tones.icon}</span>
      <div className="min-w-0">
        {title && <p className="font-medium">{title}</p>}
        <div className={clsx('text-ink-muted', title && 'mt-0.5')}>{children}</div>
      </div>
    </div>
  );
}

// -- navigation --------------------------------------------------------------

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: T; label: string; count?: number }[];
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-line" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          onClick={() => onChange(tab.id)}
          className={clsx(
            'whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors',
            active === tab.id
              ? 'border-brand text-brand'
              : 'border-transparent text-ink-muted hover:border-line hover:text-ink',
          )}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span className="tabular ml-1.5 rounded-full bg-surface-muted px-1.5 py-0.5 text-2xs text-ink-muted">
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  onChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onChange: (page: number) => void;
}) {
  if (total === 0) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
      <p className="tabular text-xs text-ink-muted">
        Showing {num(first)}–{num(last)} of {num(total)}
      </p>
      <div className="flex items-center gap-1.5">
        <button type="button" className="btn-secondary px-2.5 py-1.5 text-xs" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          Previous
        </button>
        <span className="tabular px-2 text-xs text-ink-muted">
          Page {page} of {Math.max(1, totalPages)}
        </span>
        <button
          type="button"
          className="btn-secondary px-2.5 py-1.5 text-xs"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:p-8">
      <div className="absolute inset-0" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={clsx('relative w-full rounded-xl bg-surface-raised shadow-pop', wide ? 'max-w-4xl' : 'max-w-lg')}
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          <button type="button" className="btn-ghost p-1.5" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</footer>}
      </div>
    </div>
  );
}

// -- toasts ------------------------------------------------------------------

interface Toast {
  id: number;
  tone: 'success' | 'error' | 'info';
  message: string;
}

interface ToastContextValue {
  notify: (message: string, tone?: Toast['tone']) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const notify = useCallback((message: string, tone: Toast['tone'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, tone, message }]);
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 6000);
  }, []);

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={clsx(
              'pointer-events-auto flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm shadow-pop',
              toast.tone === 'success' && 'border-positive/30 bg-surface-raised text-ink',
              toast.tone === 'error' && 'border-negative/30 bg-surface-raised text-ink',
              toast.tone === 'info' && 'border-line bg-surface-raised text-ink',
            )}
          >
            <span className="mt-0.5 shrink-0">
              {toast.tone === 'success' && <Check className="h-4 w-4 text-positive" />}
              {toast.tone === 'error' && <AlertCircle className="h-4 w-4 text-negative" />}
              {toast.tone === 'info' && <Info className="h-4 w-4 text-brand" />}
            </span>
            <p className="min-w-0 flex-1">{toast.message}</p>
            <button
              type="button"
              className="shrink-0 text-ink-subtle hover:text-ink"
              onClick={() => setToasts((current) => current.filter((t) => t.id !== toast.id))}
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside a ToastProvider');
  return context;
}
