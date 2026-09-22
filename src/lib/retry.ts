import { TmdbError } from '@/api/tmdb';

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Retry transient failures (rate limit / network / 5xx) with linear backoff, but
 * surface real HTTP errors (e.g. 404) immediately. */
export async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err instanceof TmdbError ? err.status : undefined;
      const transient = status === 429 || status === undefined || (status >= 500 && status < 600);
      if (transient && attempt < retries) {
        await sleep(500 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}
