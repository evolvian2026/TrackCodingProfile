import 'dotenv/config';
import { z } from 'zod';

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const int = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number(v)))
    .pipe(z.number().int());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: int(4000),
  HOST: z.string().default('0.0.0.0'),

  DATABASE_URL: z.string().default('postgresql://tcp:tcp@localhost:5432/tcp?schema=public'),

  // Auth
  JWT_SECRET: z.string().min(16).default('dev-only-insecure-secret-change-me'),
  JWT_ACCESS_TTL: z.string().default('30m'),
  JWT_REFRESH_TTL_DAYS: int(7),
  BCRYPT_ROUNDS: int(12),

  // CORS / web
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  TRUST_PROXY: bool(false),
  /// Where the SPA is served from, used to build shareable student links.
  /// Defaults to the first allowed CORS origin, which is right in every
  /// single-origin deployment.
  APP_BASE_URL: z.string().default(''),

  // Queue
  QUEUE_DRIVER: z.enum(['redis', 'inline']).default('inline'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  QUEUE_CONCURRENCY: int(4),
  RUN_WORKER_IN_API: bool(true),

  // Platform data
  DATA_SOURCE: z.enum(['mock', 'live']).default('mock'),
  CACHE_TTL_MINUTES: int(720),
  HTTP_TIMEOUT_MS: int(15_000),
  MAX_RETRIES: int(3),
  USER_AGENT: z
    .string()
    .default('TrackCodingProfile/1.0 (student performance analytics; +https://github.com/evolvian2026/TrackCodingProfile)'),

  // Uploads
  UPLOAD_DIR: z.string().default('./uploads'),
  MAX_UPLOAD_MB: int(15),
  MAX_UPLOAD_ROWS: int(20_000),

  // API rate limiting
  RATE_LIMIT_WINDOW_MS: int(60_000),
  RATE_LIMIT_MAX: int(300),

  // Seeding
  SEED_ADMIN_EMAIL: z.string().default('admin@tracker.local'),
  SEED_ADMIN_PASSWORD: z.string().default('Admin@12345'),
  SEED_STUDENT_COUNT: int(24),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = parsed.data;
export type Env = typeof env;

export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

if (isProd && env.JWT_SECRET === 'dev-only-insecure-secret-change-me') {
  throw new Error('JWT_SECRET must be set to a strong unique value in production.');
}
