import type { Platform } from '@prisma/client';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Token-bucket limiter. Requests queue rather than fail, so a burst of student
 * jobs degrades into a steady trickle instead of hammering a platform.
 *
 * Scope is per process. With multiple worker processes, set the per-platform
 * limit to (platform budget / worker count) — see docs/ARCHITECTURE.md.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill = Date.now();
  private chain: Promise<void> = Promise.resolve();
  /** Set when a platform told us to back off; blocks the whole bucket. */
  private penaltyUntil = 0;

  constructor(
    private ratePerMinute: number,
    private burst = Math.max(1, Math.ceil(ratePerMinute / 4)),
  ) {
    this.tokens = this.burst;
  }

  setRate(ratePerMinute: number) {
    if (ratePerMinute > 0 && ratePerMinute !== this.ratePerMinute) {
      this.ratePerMinute = ratePerMinute;
      this.burst = Math.max(1, Math.ceil(ratePerMinute / 4));
      this.tokens = Math.min(this.tokens, this.burst);
    }
  }

  /** Pause every request on this platform for `ms` (used on 429 / Retry-After). */
  penalize(ms: number) {
    this.penaltyUntil = Math.max(this.penaltyUntil, Date.now() + ms);
  }

  get penaltyRemainingMs() {
    return Math.max(0, this.penaltyUntil - Date.now());
  }

  private refill() {
    const now = Date.now();
    const elapsedMin = (now - this.lastRefill) / 60_000;
    if (elapsedMin <= 0) return;
    this.tokens = Math.min(this.burst, this.tokens + elapsedMin * this.ratePerMinute);
    this.lastRefill = now;
  }

  /** Serialize acquisition so concurrent callers cannot both drain the last token. */
  async acquire(): Promise<void> {
    const run = this.chain.then(async () => {
      for (;;) {
        const penalty = this.penaltyRemainingMs;
        if (penalty > 0) {
          await sleep(Math.min(penalty, 5_000));
          continue;
        }
        this.refill();
        if (this.tokens >= 1) {
          this.tokens -= 1;
          return;
        }
        const msPerToken = 60_000 / this.ratePerMinute;
        await sleep(Math.min(msPerToken * (1 - this.tokens) + 25, 5_000));
      }
    });
    // Keep the chain alive even if one waiter rejects.
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

const buckets = new Map<Platform, TokenBucket>();

export function getBucket(platform: Platform, ratePerMinute: number): TokenBucket {
  const existing = buckets.get(platform);
  if (existing) {
    existing.setRate(ratePerMinute);
    return existing;
  }
  const bucket = new TokenBucket(ratePerMinute);
  buckets.set(platform, bucket);
  return bucket;
}

export function bucketStatus(): Record<string, { penaltyRemainingMs: number }> {
  const out: Record<string, { penaltyRemainingMs: number }> = {};
  for (const [platform, bucket] of buckets) out[platform] = { penaltyRemainingMs: bucket.penaltyRemainingMs };
  return out;
}

/** Test helper — drops all buckets so limits do not leak between test files. */
export function resetBuckets() {
  buckets.clear();
}
