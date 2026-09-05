import { describe, test, expect } from "bun:test";
import { withRetry, RetryError } from "../../lib/retry";

/** Minimal stand-in for the Vercel AI SDK's `APICallError` shape. */
function aiSdkRateLimitError(headers: Record<string, string>) {
  return { name: "AI_APICallError", statusCode: 429, responseHeaders: headers };
}

/** The legacy fetch-style shape (`error.response.status` / `.headers` as a `Headers` instance). */
function legacyRateLimitError(headers: Record<string, string>) {
  return { response: { status: 429, headers: new Headers(headers) } };
}

describe("withRetry — Retry-After handling", () => {
  test("honors Retry-After in the AI SDK shape (statusCode + responseHeaders)", async () => {
    let calls = 0;
    const start = Date.now();

    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls === 1) throw aiSdkRateLimitError({ "retry-after": "0" });
        return "ok";
      },
      { initialDelayMs: 2000, maxDelayMs: 10_000 }
    );

    const elapsed = Date.now() - start;
    expect(result).toBe("ok");
    expect(calls).toBe(2);
    // Retry-After: 0 must override the (much larger) 2000ms initialDelayMs.
    expect(elapsed).toBeLessThan(500);
  });

  test("honors Retry-After in the legacy response.headers shape", async () => {
    let calls = 0;
    const start = Date.now();

    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls === 1) throw legacyRateLimitError({ "Retry-After": "0" });
        return "ok";
      },
      { initialDelayMs: 2000, maxDelayMs: 10_000 }
    );

    const elapsed = Date.now() - start;
    expect(result).toBe("ok");
    expect(calls).toBe(2);
    expect(elapsed).toBeLessThan(500);
  });

  test("parses Retry-After in HTTP-date form", async () => {
    let calls = 0;
    const start = Date.now();
    // HTTP-date has only second-level precision, so a date computed from "+N ms" can
    // truncate down by up to ~999ms. Use a 2s offset so the truncated value still
    // lands comfortably below the 5s initialDelayMs used to prove the override.
    const retryAt = new Date(Date.now() + 2000).toUTCString();

    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls === 1) throw aiSdkRateLimitError({ "Retry-After": retryAt });
        return "ok";
      },
      { initialDelayMs: 5000, maxDelayMs: 10_000 }
    );

    const elapsed = Date.now() - start;
    expect(result).toBe("ok");
    expect(calls).toBe(2);
    // Should wait roughly until the date (~1-2s), not the 5000ms initialDelayMs.
    expect(elapsed).toBeGreaterThanOrEqual(800);
    expect(elapsed).toBeLessThan(4000);
  });

  test("clamps an absurd Retry-After value to maxDelayMs", async () => {
    let calls = 0;
    const start = Date.now();

    const result = await withRetry(
      async () => {
        calls += 1;
        // A hostile/absurd Retry-After: ~11.5 days in seconds.
        if (calls === 1) throw aiSdkRateLimitError({ "retry-after": "999999999" });
        return "ok";
      },
      { initialDelayMs: 100, maxDelayMs: 200 }
    );

    const elapsed = Date.now() - start;
    expect(result).toBe("ok");
    expect(calls).toBe(2);
    // Clamped to maxDelayMs (200ms), not the absurd requested value.
    expect(elapsed).toBeLessThan(1000);
  });
});

describe("withRetry — shouldRetry predicate", () => {
  test("shouldRetry returning false exits immediately, without sleeping", async () => {
    let calls = 0;
    const start = Date.now();

    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new Error("boom");
        },
        {
          maxRetries: 5,
          initialDelayMs: 5000,
          maxDelayMs: 10_000,
          shouldRetry: () => false,
        }
      )
    ).rejects.toThrow(RetryError);

    const elapsed = Date.now() - start;
    expect(calls).toBe(1); // no further attempts made
    expect(elapsed).toBeLessThan(200); // proves no sleep happened, not just that it failed
  });

  test("shouldRetry receives the error and attempt index, and can allow retries selectively", async () => {
    let calls = 0;
    const seenAttempts: number[] = [];

    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error(`fail-${calls}`);
        return "ok";
      },
      {
        maxRetries: 5,
        initialDelayMs: 5,
        maxDelayMs: 20,
        shouldRetry: (error, attempt) => {
          seenAttempts.push(attempt);
          expect(error).toBeInstanceOf(Error);
          return true;
        },
      }
    );

    expect(result).toBe("ok");
    expect(calls).toBe(3);
    expect(seenAttempts).toEqual([0, 1]);
  });

  test("default behavior (shouldRetry omitted) is unchanged: retries every error until maxRetries is exhausted", async () => {
    let calls = 0;

    let thrown: unknown;
    try {
      await withRetry(
        async () => {
          calls += 1;
          throw new Error("always fails");
        },
        { maxRetries: 2, initialDelayMs: 5, maxDelayMs: 20 }
      );
    } catch (error) {
      thrown = error;
    }

    expect(calls).toBe(3); // 1 initial + 2 retries
    expect(thrown).toBeInstanceOf(RetryError);
    expect((thrown as RetryError).attempts).toBe(3);
    expect((thrown as RetryError).message).toBe("Failed after 3 attempts");
  });

  test("default behavior (shouldRetry omitted) still succeeds on a later attempt", async () => {
    let calls = 0;

    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 2) throw new Error("transient");
        return "ok";
      },
      { maxRetries: 2, initialDelayMs: 5, maxDelayMs: 20 }
    );

    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });
});
