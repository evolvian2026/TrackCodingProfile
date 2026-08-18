import { env } from '../config/env.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 } as const;
const threshold = LEVELS[env.LOG_LEVEL];

function emit(level: keyof typeof LEVELS, msg: string, meta?: unknown) {
  if (LEVELS[level] < threshold) return;
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${msg}`;
  const out = level === 'error' || level === 'warn' ? console.error : console.log;
  if (meta === undefined) out(line);
  else out(line, meta);
}

export const logger = {
  debug: (msg: string, meta?: unknown) => emit('debug', msg, meta),
  info: (msg: string, meta?: unknown) => emit('info', msg, meta),
  warn: (msg: string, meta?: unknown) => emit('warn', msg, meta),
  error: (msg: string, meta?: unknown) => emit('error', msg, meta),
};
