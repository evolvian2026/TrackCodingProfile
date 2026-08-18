import type { Platform } from '@prisma/client';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { getBucket } from './rateLimiter.js';
import { PlatformFetchError } from './types.js';
import { getProcessingLimits } from '../services/settings.service.js';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface RequestOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
  /** Treat a 404 as NOT_FOUND rather than an error (the default). */
  timeoutMs?: number;
  /** Overrides the retry count from processing limits. */
  maxRetries?: number;
  accept?: 'json' | 'text';
}

export interface PlatformResponse<T> {
  status: number;
  data: T;
  headers: Headers;
}

function parseRetryAfter(headers: Headers): number | undefined {
  const raw = headers.get('retry-after');
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

/**
 * Rate-limited, retrying HTTP client shared by every adapter.
 *
 * - one token bucket per platform (never more than N req/min)
 * - exponential backoff with full jitter on 429/5xx/network errors
 * - honours `Retry-After` and applies it to the whole platform bucket
 * - gives up after `maxRetries` and reports RATE_LIMITED / UNAVAILABLE
 */
export async function platformRequest<T = unknown>(
  platform: Platform,
  url: string,
  options: RequestOptions = {},
): Promise<PlatformResponse<T>> {
  const limits = await getProcessingLimits();
  const rate = limits.perPlatformRatePerMinute[platform] ?? 10;
  const bucket = getBucket(platform, rate);
  const maxRetries = options.maxRetries ?? limits.maxRetries;
  const timeoutMs = options.timeoutMs ?? limits.requestTimeoutMs;

  let lastError: PlatformFetchError | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await bucket.acquire();
    if (limits.jitterMs > 0) await sleep(Math.random() * limits.jitterMs);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: options.method ?? 'GET',
        headers: {
          'user-agent': env.USER_AGENT,
          accept: options.accept === 'text' ? 'text/html,application/xhtml+xml' : 'application/json',
          ...(options.body ? { 'content-type': 'application/json' } : {}),
          ...options.headers,
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
        redirect: 'follow',
      });

      if (res.status === 429 || res.status === 403) {
        const retryAfter = parseRetryAfter(res.headers) ?? backoffDelay(attempt, limits.retryBaseDelayMs, limits.retryMaxDelayMs);
        bucket.penalize(Math.min(retryAfter, limits.retryMaxDelayMs));
        lastError = new PlatformFetchError('RATE_LIMITED', `${platform} returned HTTP ${res.status}`, true, retryAfter);
        logger.warn(`${platform} rate limited (HTTP ${res.status}), attempt ${attempt + 1}/${maxRetries + 1}`);
        if (attempt < maxRetries) {
          await sleep(Math.min(retryAfter, limits.retryMaxDelayMs));
          continue;
        }
        throw lastError;
      }

      if (res.status === 404 || res.status === 410) {
        throw new PlatformFetchError('NOT_FOUND', `${platform} profile not found (HTTP ${res.status})`);
      }

      if (res.status >= 500) {
        lastError = new PlatformFetchError('UNAVAILABLE', `${platform} returned HTTP ${res.status}`, true);
        if (attempt < maxRetries) {
          await sleep(backoffDelay(attempt, limits.retryBaseDelayMs, limits.retryMaxDelayMs));
          continue;
        }
        throw lastError;
      }

      if (!res.ok) {
        throw new PlatformFetchError('ERROR', `${platform} returned HTTP ${res.status}`);
      }

      const data = (options.accept === 'text' ? await res.text() : await res.json()) as T;
      return { status: res.status, data, headers: res.headers };
    } catch (err) {
      if (err instanceof PlatformFetchError) {
        if (!err.retryable || attempt >= maxRetries) throw err;
        lastError = err;
        await sleep(backoffDelay(attempt, limits.retryBaseDelayMs, limits.retryMaxDelayMs));
        continue;
      }
      const aborted = err instanceof Error && err.name === 'AbortError';
      lastError = new PlatformFetchError(
        'UNAVAILABLE',
        aborted ? `${platform} request timed out after ${timeoutMs}ms` : `${platform} request failed: ${(err as Error).message}`,
        true,
      );
      if (attempt >= maxRetries) throw lastError;
      await sleep(backoffDelay(attempt, limits.retryBaseDelayMs, limits.retryMaxDelayMs));
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new PlatformFetchError('ERROR', `${platform} request failed`);
}

/** Exponential backoff with full jitter, capped. */
export function backoffDelay(attempt: number, baseMs: number, maxMs: number): number {
  const exponential = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.round(Math.random() * exponential);
}
