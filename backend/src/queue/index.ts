import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { InlineQueueDriver } from './inline.driver.js';
import { RedisQueueDriver } from './redis.driver.js';
import type { QueueDriver } from './types.js';

let driver: QueueDriver | null = null;

export function getQueue(): QueueDriver {
  if (driver) return driver;
  driver =
    env.QUEUE_DRIVER === 'redis'
      ? new RedisQueueDriver(env.QUEUE_CONCURRENCY)
      : new InlineQueueDriver(env.QUEUE_CONCURRENCY);
  logger.info(`Queue driver: ${driver.name} (concurrency ${env.QUEUE_CONCURRENCY})`);
  return driver;
}

export async function closeQueue(): Promise<void> {
  await driver?.close();
  driver = null;
}

export * from './types.js';
