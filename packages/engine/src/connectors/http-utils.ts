const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const BASE_DELAY_MS = 1_000;

export type FetchFunction = (url: string, init?: RequestInit) => Promise<Response>;

export interface RetryOptions {
  readonly maxRetries?: number;
  readonly timeoutMs?: number;
  readonly fetchFn?: FetchFunction;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

/**
 * Fetch with timeout and retry (exponential backoff) for 429/5xx responses.
 * Accepts an optional custom fetch function for DI/testing.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: RetryOptions = {},
): Promise<Response> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doFetch = options.fetchFn ?? globalThis.fetch.bind(globalThis);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await doFetch(url, {
        ...init,
        signal: controller.signal,
      });

      if (isRetryableStatus(response.status) && attempt < maxRetries) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      return response;
    } catch (err: unknown) {
      if (attempt >= maxRetries) {
        throw err;
      }
      const delay = BASE_DELAY_MS * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error("fetchWithRetry: exhausted retries");
}
