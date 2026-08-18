import { logger } from '../lib/logger.js';
import type { FetchJobPayload, JobHandler, QueueDriver } from './types.js';

/**
 * Zero-infrastructure queue: an in-process FIFO with a bounded worker pool.
 *
 * Chosen so the application runs with nothing but PostgreSQL. Job *state* lives
 * in `processing_job_items`, not in this array, so a restart resumes cleanly
 * (see `resumeInterruptedJobs`). For multi-process deployments switch to
 * QUEUE_DRIVER=redis.
 */
export class InlineQueueDriver implements QueueDriver {
  readonly name = 'inline' as const;

  private queue: FetchJobPayload[] = [];
  private handler: JobHandler | null = null;
  private active = 0;
  private cancelled = new Set<string>();
  private draining = false;
  private closed = false;

  constructor(private concurrency: number) {}

  async start(handler: JobHandler): Promise<void> {
    this.handler = handler;
    this.pump();
  }

  async enqueue(payload: FetchJobPayload): Promise<void> {
    this.queue.push(payload);
    this.pump();
  }

  async enqueueMany(payloads: FetchJobPayload[]): Promise<void> {
    this.queue.push(...payloads);
    this.pump();
  }

  async cancel(jobId: string): Promise<void> {
    this.cancelled.add(jobId);
    this.queue = this.queue.filter((p) => p.jobId !== jobId);
  }

  async stats() {
    return { waiting: this.queue.length, active: this.active };
  }

  async close(): Promise<void> {
    this.closed = true;
    this.queue = [];
    // Let in-flight work finish so no student is left half-written.
    while (this.active > 0) await new Promise((r) => setTimeout(r, 50));
  }

  private pump(): void {
    if (this.draining) return;
    this.draining = true;
    queueMicrotask(() => {
      this.draining = false;
      while (!this.closed && this.handler && this.active < this.concurrency && this.queue.length > 0) {
        const payload = this.queue.shift()!;
        if (this.cancelled.has(payload.jobId)) continue;
        this.active += 1;
        void this.handler(payload)
          .catch((err) => logger.error('Inline queue handler threw', err))
          .finally(() => {
            this.active -= 1;
            this.pump();
          });
      }
    });
  }
}
