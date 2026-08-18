import type { Platform } from '@prisma/client';

export interface FetchJobPayload {
  jobId: string;
  itemId: string;
  studentId: string;
  platform: Platform;
  username: string;
  force: boolean;
}

export type JobHandler = (payload: FetchJobPayload) => Promise<void>;

export interface QueueDriver {
  readonly name: 'redis' | 'inline';
  enqueue(payload: FetchJobPayload): Promise<void>;
  enqueueMany(payloads: FetchJobPayload[]): Promise<void>;
  /** Registers the worker. Safe to call once per process. */
  start(handler: JobHandler): Promise<void>;
  /** Best-effort removal of not-yet-started jobs for a processing job. */
  cancel(jobId: string): Promise<void>;
  stats(): Promise<{ waiting: number; active: number }>;
  close(): Promise<void>;
}
