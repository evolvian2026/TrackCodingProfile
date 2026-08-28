import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './db/prisma.js';
import { closeQueue, getQueue } from './queue/index.js';
import { processJobItem, resumeInterruptedJobs } from './services/processing.service.js';
import { startScheduler, stopScheduler } from './services/scheduler.js';
import { purgeExpiredCache } from './platforms/cache.js';
import { cleanupOldUploads } from './modules/upload/upload.service.js';
import { purgeExpiredRefreshTokens } from './modules/auth/auth.service.js';

const MAINTENANCE_INTERVAL_MS = 60 * 60_000;

/**
 * Standalone worker process. Run alongside the API when
 * RUN_WORKER_IN_API=false, or scale several of these against Redis.
 */
async function main() {
  if (env.QUEUE_DRIVER === 'inline') {
    logger.warn('QUEUE_DRIVER=inline — a standalone worker only drains jobs it enqueues itself. Use redis for a split deployment.');
  }

  await getQueue().start(processJobItem);
  await resumeInterruptedJobs().catch((err) => logger.warn('Could not resume interrupted jobs', err.message));
  // The scheduler lives with the worker: it only makes sense where jobs run.
  startScheduler();
  logger.info(`Worker started (data source: ${env.DATA_SOURCE})`);

  const maintenance = setInterval(() => {
    void (async () => {
      const [cache, uploads, tokens] = await Promise.all([
        purgeExpiredCache().catch(() => 0),
        cleanupOldUploads().catch(() => 0),
        purgeExpiredRefreshTokens().catch(() => 0),
      ]);
      logger.info(`Maintenance: purged ${cache} cache entries, ${uploads} stored uploads, ${tokens} expired tokens`);
    })();
  }, MAINTENANCE_INTERVAL_MS);

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, worker shutting down`);
    clearInterval(maintenance);
    stopScheduler();
    await closeQueue().catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error('Worker failed to start', err);
  process.exit(1);
});
