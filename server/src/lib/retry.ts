/**
 * Generic retry wrapper with exponential backoff
 * Respects Retry-After header on 429 responses
 */

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  /**
   * Called with the thrown error and the zero-based index of the attempt that just
   * failed. Return `false` to give up immediately — no further attempts, and no sleep
   * before the throw. Omit to retry every error unconditionally until `maxRetries` is
   * exhausted (the default, unchanged behavior).
   */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

export class RetryError extends Error {
  constructor(
    message: string,
    public readonly lastError: Error,
    public readonly attempts: number
  ) {
    super(message);
    this.name = "RetryError";
  }
}

/**
 * Retry a function with exponential backoff
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    maxDelayMs = 10000,
    backoffMultiplier = 2,
    shouldRetry,
  } = options;

  let lastError: Error | undefined;
  let delay = initialDelayMs;
  let attemptsMade = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      attemptsMade = attempt + 1;

      // Give up without sleeping once attempts are exhausted, or as soon as the
      // caller opts out of retrying this particular error (e.g. an invalid API key,
      // which must never be retried — retrying it can trip provider abuse limits).
      const exhausted = attempt >= maxRetries;
      const optedOut = shouldRetry ? !shouldRetry(error, attempt) : false;
      if (exhausted || optedOut) {
        break;
      }

      // Check for Retry-After header (429 rate limit)
      let waitTime = delay;
      if (isRateLimitError(error)) {
        const retryAfter = getRetryAfterMs(error, maxDelayMs);
        if (retryAfter !== null) {
          waitTime = retryAfter;
        }
      }

      // Wait before retrying
      await sleep(waitTime);

      // Exponential backoff for next attempt
      delay = Math.min(delay * backoffMultiplier, maxDelayMs);
    }
  }

  throw new RetryError(`Failed after ${attemptsMade} attempts`, lastError!, attemptsMade);
}

/**
 * Check if an error is a rate-limit (429) error. Handles the two shapes seen in this
 * codebase:
 *  - the legacy fetch-style shape used by the Kroger/OpenFoodFacts provider code:
 *    `{ response: { status, headers } }`, where `headers` is a `Headers` instance.
 *  - the Vercel AI SDK's `APICallError` shape (thrown by every LLM provider call):
 *    `{ statusCode, responseHeaders }`, where `responseHeaders` is a plain
 *    `Record<string, string>`, not a `Headers` instance.
 */
export function isRateLimitError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { response?: { status?: unknown }; statusCode?: unknown };

  if (typeof e.statusCode === "number" && e.statusCode === 429) return true;

  if (typeof e.response === "object" && e.response !== null) {
    return (e.response as { status?: unknown }).status === 429;
  }

  return false;
}

/**
 * Reads the raw `Retry-After` header value from either error shape handled by
 * {@link isRateLimitError}. The AI SDK's `responseHeaders` is looked up
 * case-insensitively since it's a plain object rather than a `Headers` instance
 * (which normalizes case itself via `.get()`).
 */
function getRetryAfterHeaderValue(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const e = error as {
    response?: { headers?: Headers };
    responseHeaders?: Record<string, string>;
  };

  if (e.responseHeaders && typeof e.responseHeaders === "object") {
    const key = Object.keys(e.responseHeaders).find((k) => k.toLowerCase() === "retry-after");
    if (key) return e.responseHeaders[key] ?? null;
  }

  const headers = e.response?.headers;
  if (headers && typeof headers.get === "function") {
    return headers.get("Retry-After");
  }

  return null;
}

/**
 * Extract the Retry-After header value in milliseconds, supporting both the
 * integer-seconds form and the HTTP-date form. The result is clamped to
 * `[0, maxDelayMs]` so a hostile or malformed header value (e.g. an absurdly large
 * second count, or a date far in the future) can never stall the retry loop.
 */
export function getRetryAfterMs(error: unknown, maxDelayMs: number): number | null {
  try {
    const retryAfter = getRetryAfterHeaderValue(error);
    if (!retryAfter) return null;

    let ms: number | null = null;

    // Retry-After can be in seconds (integer) or an HTTP date.
    const seconds = parseInt(retryAfter, 10);
    if (!isNaN(seconds)) {
      ms = seconds * 1000;
    } else {
      const date = new Date(retryAfter);
      if (!isNaN(date.getTime())) {
        ms = date.getTime() - Date.now();
      }
    }

    if (ms === null) return null;
    return Math.min(Math.max(0, ms), maxDelayMs);
  } catch {
    return null;
  }
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Rate limiter class for tracking request counts
 */
export class RateLimiter {
  private requests: number[] = [];

  constructor(
    private maxRequests: number,
    private windowMs: number
  ) {}

  /**
   * Check if a request can be made, clean up old requests
   */
  canMakeRequest(): boolean {
    const now = Date.now();
    // Remove requests outside the time window
    this.requests = this.requests.filter((time) => now - time < this.windowMs);
    return this.requests.length < this.maxRequests;
  }

  /**
   * Record a request
   */
  recordRequest(): void {
    this.requests.push(Date.now());
  }

  /**
   * Wait until a request can be made
   */
  async waitForSlot(): Promise<void> {
    while (!this.canMakeRequest()) {
      // Wait for 100ms and check again
      await sleep(100);
    }
    this.recordRequest();
  }
}
