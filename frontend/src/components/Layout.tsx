import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  BarChart3, Building2, GitCompare, LayoutDashboard, ListChecks, LogOut, Menu, Monitor,
  Moon, Search, Settings, ShieldAlert, Sun, Target, Trophy, Upload, Users, Layers, X,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../hooks/useTheme';
import { alertsApi, studentsApi } from '../api/endpoints';
import { num } from '../lib/format';

const NAV_SECTIONS: {
  heading: string;
  items: { to: string; label: string; icon: typeof LayoutDashboard; badge?: 'alerts' }[];
}[] = [
  {
    heading: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/leaderboard', label: 'Leaderboard', icon: Trophy },
      { to: '/analytics', label: 'Analytics', icon: BarChart3 },
      { to: '/alerts', label: 'Needs attention', icon: ShieldAlert, badge: 'alerts' },
      { to: '/goals', label: 'Goals', icon: Target },
    ],
  },
  {
    heading: 'Students',
    items: [
      { to: '/students', label: 'Students', icon: Users },
      { to: '/compare', label: 'Compare', icon: GitCompare },
      { to: '/batches', label: 'Batches', icon: Layers },
      { to: '/colleges', label: 'Colleges', icon: Building2 },
    ],
  },
  {
    heading: 'Data',
    items: [
      { to: '/upload', label: 'Upload Excel', icon: Upload },
      { to: '/jobs', label: 'Processing', icon: ListChecks },
      { to: '/platforms', label: 'Platforms', icon: Monitor },
      { to: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

export function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-surface">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="lg:pl-60">
        <TopBar onOpenSidebar={() => setSidebarOpen(true)} />
        <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Open concerns only — an acknowledged one should not keep nagging.
  const { data: alertSummary } = useQuery({
    queryKey: ['alert-summary'],
    queryFn: () => alertsApi.summary(),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
  const openAlerts = alertSummary?.unacknowledged ?? 0;

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={onClose} aria-hidden />}
      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-line bg-surface-raised transition-transform lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
          <Link to="/" className="flex items-center gap-2" onClick={onClose}>
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand text-xs font-bold text-white">CP</span>
            <span className="text-sm font-semibold tracking-tight text-ink">Profile Tracker</span>
          </Link>
          <button type="button" className="btn-ghost p-1.5 lg:hidden" onClick={onClose} aria-label="Close navigation">
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
          {NAV_SECTIONS.map((section) => (
            <div key={section.heading}>
              <p className="mb-1.5 px-2.5 text-2xs font-semibold uppercase tracking-wider text-ink-subtle">
                {section.heading}
              </p>
              <ul className="space-y-0.5">
                {section.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.to === '/'}
                      onClick={onClose}
                      className={({ isActive }) =>
                        clsx(
                          'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
                          isActive ? 'bg-brand-soft text-brand' : 'text-ink-muted hover:bg-surface-muted hover:text-ink',
                        )
                      }
                    >
                      <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                      <span className="flex-1">{item.label}</span>
                      {item.badge === 'alerts' && openAlerts > 0 && (
                        <span className="tabular rounded-full bg-caution/15 px-1.5 py-0.5 text-2xs font-semibold text-caution">
                          {openAlerts > 99 ? '99+' : openAlerts}
                        </span>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}

function TopBar({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-surface-raised/95 px-4 backdrop-blur sm:px-6">
      <button type="button" className="btn-ghost p-1.5 lg:hidden" onClick={onOpenSidebar} aria-label="Open navigation">
        <Menu className="h-5 w-5" />
      </button>

      <GlobalSearch />

      <div className="ml-auto flex items-center gap-1.5">
        <ThemeToggle />
        <div className="hidden text-right sm:block">
          <p className="text-xs font-medium leading-tight text-ink">{user?.name}</p>
          <p className="text-2xs leading-tight text-ink-subtle">{user?.role}</p>
        </div>
        <button
          type="button"
          className="btn-ghost p-1.5"
          title="Sign out"
          onClick={async () => {
            await logout();
            navigate('/login');
          }}
        >
          <LogOut className="h-4 w-4" />
          <span className="sr-only">Sign out</span>
        </button>
      </div>
    </header>
  );
}

function ThemeToggle() {
  const { setting, setSetting } = useTheme();
  const next = setting === 'light' ? 'dark' : setting === 'dark' ? 'system' : 'light';
  const Icon = setting === 'light' ? Sun : setting === 'dark' ? Moon : Monitor;

  return (
    <button
      type="button"
      className="btn-ghost p-1.5"
      onClick={() => setSetting(next)}
      title={`Theme: ${setting}. Click for ${next}.`}
    >
      <Icon className="h-4 w-4" />
      <span className="sr-only">Switch theme (currently {setting})</span>
    </button>
  );
}

/** Global search over name, ID, email, college and platform handles. */
function GlobalSearch() {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const { data, isFetching } = useQuery({
    queryKey: ['quick-search', debounced],
    queryFn: () => studentsApi.search(debounced),
    enabled: debounced.length >= 2,
  });

  const results = data ?? [];

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" aria-hidden />
      <input
        type="search"
        value={query}
        placeholder="Search students, IDs, handles…"
        aria-label="Search students"
        className="input pl-9"
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && results[0]) {
            navigate(`/students/${results[0].id}`);
            setOpen(false);
            setQuery('');
          }
          if (event.key === 'Escape') setOpen(false);
        }}
      />

      {open && debounced.length >= 2 && (
        <div className="absolute left-0 right-0 top-full mt-1.5 max-h-96 overflow-y-auto rounded-lg border border-line bg-surface-raised py-1 shadow-pop">
          {isFetching && results.length === 0 && <p className="px-3 py-2.5 text-sm text-ink-muted">Searching…</p>}
          {!isFetching && results.length === 0 && (
            <p className="px-3 py-2.5 text-sm text-ink-muted">No students match “{debounced}”.</p>
          )}
          {results.map((student) => (
            <button
              key={student.id}
              type="button"
              className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left hover:bg-surface-muted"
              onClick={() => {
                navigate(`/students/${student.id}`);
                setOpen(false);
                setQuery('');
              }}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-ink">{student.name}</span>
                <span className="block truncate text-xs text-ink-muted">
                  {[student.studentId, student.branch, student.batch, student.college].filter(Boolean).join(' · ')}
                </span>
                {student.handles.length > 0 && (
                  <span className="mt-0.5 block truncate text-2xs text-ink-subtle">
                    {student.handles.map((h) => `${h.label}: ${h.username}`).join('  ·  ')}
                  </span>
                )}
              </span>
              <span className="tabular shrink-0 text-right text-xs text-ink-muted">
                {student.totalSolved !== null ? `${num(student.totalSolved)} solved` : 'No data'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
