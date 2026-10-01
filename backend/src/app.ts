import path from 'node:path';
import fs from 'node:fs';
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
import { alertsRouter, scheduleRouter } from './modules/alerts/alerts.routes.js';
import { goalsRouter } from './modules/goals/goals.routes.js';
import { publicShareRouter, shareAdminRouter, studentShareRouter } from './modules/share/share.routes.js';
import { prisma } from './db/prisma.js';
import { logger } from './lib/logger.js';

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
  app.use('/api/alerts', alertsRouter);
  app.use('/api/schedule', scheduleRouter);
  app.use('/api/goals', goalsRouter);
  // Deliberately unauthenticated: a student opening their own link has no
  // account. It carries its own tighter rate limit and returns only that one
  // student's record.
  app.use('/api/shared', publicShareRouter);
  app.use('/api/students', studentShareRouter);
  app.use('/api/share-links', shareAdminRouter);

  // Optionally serve the built SPA from this same process, which makes the whole
  // app one origin on one host. That is not only tidier: the refresh cookie is
  // SameSite=Strict, so an SPA served from a different site than the API never
  // sends it, and every session would end when the access token expires.
  if (env.SERVE_WEB) {
    const dist = path.resolve(process.cwd(), env.WEB_DIST_DIR);
    const indexHtml = path.join(dist, 'index.html');

    if (!fs.existsSync(indexHtml)) {
      // Say so at boot rather than serving 404s and letting someone wonder why
      // the API works but the page is blank.
      logger.warn(`SERVE_WEB is on but no built SPA was found at ${dist} — run the frontend build first`);
    } else {
      // Hashed filenames, so these can be cached hard. index.html must not be.
      app.use('/assets', express.static(path.join(dist, 'assets'), { immutable: true, maxAge: '1y' }));
      app.use(express.static(dist, { index: false, maxAge: '1h' }));

      // Single-page app: any non-API path is a client route. /api is excluded so
      // an unknown endpoint still answers with a JSON 404 rather than HTML.
      app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(indexHtml));
      logger.info(`Serving the SPA from ${dist}`);
    }
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
