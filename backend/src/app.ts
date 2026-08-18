import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { env, isProd, isTest } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { studentsRouter } from './modules/students/students.routes.js';
import { uploadRouter } from './modules/upload/upload.routes.js';
import { jobsRouter } from './modules/jobs/jobs.routes.js';
import { analyticsRouter } from './modules/analytics/analytics.routes.js';
import { leaderboardRouter } from './modules/analytics/leaderboard.routes.js';
import { reportsRouter } from './modules/reports/report.routes.js';
import { settingsRouter } from './modules/settings/settings.routes.js';
import { prisma } from './db/prisma.js';

export function createApp() {
  const app = express();

  if (env.TRUST_PROXY) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // The API serves JSON and file downloads only; the SPA is served separately.
      contentSecurityPolicy: isProd ? undefined : false,
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  const allowedOrigins = env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);
  app.use(
    cors({
      origin: (origin, callback) => {
        // Same-origin and server-to-server requests arrive without an Origin.
        if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) return callback(null, true);
        callback(new Error(`Origin ${origin} is not allowed by CORS`));
      },
      credentials: true,
    }),
  );

  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());
  if (!isTest) app.use(morgan(isProd ? 'combined' : 'dev'));

  app.use(
    '/api',
    rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      limit: env.RATE_LIMIT_MAX,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      skip: () => isTest,
      message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' } },
    }),
  );

  app.get('/api/health', async (_req, res) => {
    let database = 'up';
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'down';
    }
    res.status(database === 'up' ? 200 : 503).json({
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      dataSource: env.DATA_SOURCE,
      queueDriver: env.QUEUE_DRIVER,
      time: new Date().toISOString(),
    });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/students', studentsRouter);
  // Spec-mandated alias: POST /api/students/upload
  app.use('/api/students/upload', uploadRouter);
  app.use('/api/uploads', uploadRouter);
  app.use('/api/jobs', jobsRouter);
  app.use('/api/analytics', analyticsRouter);
  app.use('/api/leaderboard', leaderboardRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/settings', settingsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
