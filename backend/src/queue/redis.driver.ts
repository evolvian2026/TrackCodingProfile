import { Queue, Worker, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import type { FetchJobPayload, JobHandler, QueueDriver } from './types.js';

const QUEUE_NAME = 'platform-fetch';

/** Durable queue for multi-worker deployments. */
export class RedisQueueDriver implements QueueDriver {
  readonly name = 'redis' as const;

  private connection: Redis;
  private queue: Queue<FetchJobPayload>;
  private worker: Worker<FetchJobPayload> | null = null;

  constructor(private concurrency: number) {
    this.connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false });
    this.connection.on('error', (err: Error) => logger.error('Redis connection error', err.message));
    this.queue = new Queue<FetchJobPayload>(QUEUE_NAME, { connection: this.connection });
  }

  private get jobOptions(): JobsOptions {
    return {
      // Retries are handled by the processing service so failures are visible
      // in `processing_job_items` rather than hidden inside BullMQ.
      attempts: 1,
      removeOnComplete: { age: 3600, count: 5_000 },
      removeOnFail: { age: 86_400 },
    };
  }

  async start(handler: JobHandler): Promise<void> {
    if (this.worker) return;
    this.worker = new Worker<FetchJobPayload>(QUEUE_NAME, async (job) => handler(job.data), {
      connection: this.connection.duplicate(),
      concurrency: this.concurrency,
    });
    this.worker.on('failed', (job, err) => logger.error(`Queue job ${job?.id} failed`, err.message));
    logger.info(`BullMQ worker listening on "${QUEUE_NAME}" with concurrency ${this.concurrency}`);
  }

  async enqueue(payload: FetchJobPayload): Promise<void> {
    await this.queue.add('fetch', payload, this.jobOptions);
  }

  async enqueueMany(payloads: FetchJobPayload[]): Promise<void> {
    if (payloads.length === 0) return;
    await this.queue.addBulk(payloads.map((data) => ({ name: 'fetch', data, opts: this.jobOptions })));
  }

  async cancel(jobId: string): Promise<void> {
    const waiting = await this.queue.getJobs(['waiting', 'delayed', 'paused'], 0, 50_000);
    await Promise.all(waiting.filter((j) => j.data.jobId === jobId).map((j) => j.remove().catch(() => undefined)));
  }

  async stats() {
    const counts = await this.queue.getJobCounts('waiting', 'active');
    return { waiting: counts.waiting ?? 0, active: counts.active ?? 0 };
  }

  async close(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
    await this.connection.quit().catch(() => undefined);
  }
}
