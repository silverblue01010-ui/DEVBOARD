import { redis } from "../lib/redis";
import { logger } from "../lib/logger";

function rateLimitKey(installationId: string) {
  return `devboard:ratelimit:${installationId}`;
}

export async function trackRateLimit(installationId: string, headers: Record<string, string>) {
  const remaining = headers["x-ratelimit-remaining"];
  const reset = headers["x-ratelimit-reset"];
  if (remaining === undefined || reset === undefined) return;

  const resetAt = Number(reset) * 1000;
  await redis.set(
    rateLimitKey(installationId),
    JSON.stringify({ remaining: Number(remaining), resetAt }),
    "PX",
    Math.max(resetAt - Date.now(), 1000)
  );

  if (Number(remaining) < 100) {
    logger.warn({ installationId, remaining, resetAt }, "GitHub rate limit running low, throttling installation");
  }
}

/**
 * If remaining < 100, jobs for this installation should be requeued with a delay
 * until resetAt rather than failed (Phase 6, Risk 3).
 */
export async function isThrottled(installationId: string): Promise<boolean> {
  const raw = await redis.get(rateLimitKey(installationId));
  if (!raw) return false;
  const { remaining, resetAt } = JSON.parse(raw);
  return remaining < 100 && Date.now() < resetAt;
}

export async function msUntilReset(installationId: string): Promise<number> {
  const raw = await redis.get(rateLimitKey(installationId));
  if (!raw) return 0;
  const { resetAt } = JSON.parse(raw);
  return Math.max(resetAt - Date.now(), 0);
}

/**
 * Exponential backoff helper for 403/429 responses: 1s, 2s, 4s, ... capped at 60s,
 * max 5 retries before the caller should mark the job failed.
 */
export async function withBackoff<T>(fn: () => Promise<T>, maxRetries = 5): Promise<T> {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition -- intentional retry loop; every path either returns or throws
  while (true) {
    try {
      return await fn();
    } catch (err: any) {
      const status = err?.status;
      if ((status === 403 || status === 429) && attempt < maxRetries) {
        const delay = Math.min(1000 * 2 ** attempt, 60000);
        logger.warn({ status, attempt, delay }, "GitHub API throttled, backing off");
        await new Promise((r) => setTimeout(r, delay));
        attempt++;
        continue;
      }
      throw err;
    }
  }
}
