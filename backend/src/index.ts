import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './db/prisma.js';
import { closeQueue, getQueue } from './queue/index.js';
import { processJobItem, resumeInterruptedJobs } from './services/processing.service.js';
import { startScheduler, stopScheduler } from './services/scheduler.js';
import { ensureUploadDir } from './modules/upload/upload.service.js';

async function main() {
  await ensureUploadDir();

  if (env.RUN_WORKER_IN_API) {
    // Single-process mode: the API also drains the queue. Set
    // RUN_WORKER_IN_API=false and run `npm run start:worker` to split them.
    await getQueue().start(processJobItem);
    await resumeInterruptedJobs().catch((err) => logger.warn('Could not resume interrupted jobs', err.message));
    // The scheduler lives with the worker: it only makes sense where jobs run.
    startScheduler();
  }

  const app = createApp();
  const server = app.listen(env.PORT, env.HOST, () => {
    logger.info(`API listening on http://${env.HOST}:${env.PORT} (${env.NODE_ENV}, data source: ${env.DATA_SOURCE})`);
  });

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    server.close();
    stopScheduler();
    await closeQueue().catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error('Failed to start the API', err);
  process.exit(1);
});
