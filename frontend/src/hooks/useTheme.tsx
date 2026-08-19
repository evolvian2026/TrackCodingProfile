import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ThemeMode } from '../lib/palette';

type ThemeSetting = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  setting: ThemeSetting;
  /** The mode actually in effect — what chart colours must be chosen for. */
  mode: ThemeMode;
  setSetting: (setting: ThemeSetting) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = 'tcp-theme';

function systemMode(): ThemeMode {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [setting, setSettingState] = useState<ThemeSetting>(
    () => (localStorage.getItem(STORAGE_KEY) as ThemeSetting | null) ?? 'system',
  );
  const [resolved, setResolved] = useState<ThemeMode>(() =>
    (localStorage.getItem(STORAGE_KEY) as ThemeSetting | null) === 'dark'
      ? 'dark'
      : (localStorage.getItem(STORAGE_KEY) as ThemeSetting | null) === 'light'
        ? 'light'
        : systemMode(),
  );

  // Track the OS preference only while the user is on "system".
  useEffect(() => {
    if (setting !== 'system') {
      setResolved(setting);
      return;
    }
    setResolved(systemMode());
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setResolved(systemMode());
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [setting]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark');
    document.documentElement.style.colorScheme = resolved;
  }, [resolved]);

  const setSetting = useCallback((next: ThemeSetting) => {
    localStorage.setItem(STORAGE_KEY, next);
    setSettingState(next);
  }, []);

  const value = useMemo(() => ({ setting, mode: resolved, setSetting }), [setting, resolved, setSetting]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside a ThemeProvider');
  return context;
}
