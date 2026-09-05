import { Context, Next } from "hono";

/**
 * Simple in-memory rate limiter
 * For production, consider using Redis
 */
class RateLimiter {
  private requests = new Map<string, { count: number; resetAt: number }>();

  /**
   * Check if request is allowed
   */
  check(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    const record = this.requests.get(key);

    if (!record || now > record.resetAt) {
      // New window
      this.requests.set(key, {
        count: 1,
        resetAt: now + windowMs,
      });
      return true;
    }

    if (record.count >= limit) {
      return false;
    }

    record.count++;
    return true;
  }

  /**
   * Clean up expired entries
   */
  cleanup() {
    const now = Date.now();
    for (const [key, record] of this.requests.entries()) {
      if (now > record.resetAt) {
        this.requests.delete(key);
      }
    }
  }
}

const limiter = new RateLimiter();

// Cleanup every 5 minutes
setInterval(() => limiter.cleanup(), 5 * 60 * 1000);

/**
 * Checks (and records) a rate-limit hit for an arbitrary caller-supplied key.
 *
 * Unlike `rateLimitMiddleware` below — which keys on the raw `x-forwarded-for` header
 * and is therefore spoofable by anyone who controls a prefix of a header Caddy only
 * ever *appends* to — callers protecting a paid/abusable resource (e.g. LLM
 * generation) MUST build `key` from an authenticated, server-trusted identifier such
 * as `householdId`/`userId` from the session, never from a request header (plan
 * §6.5). Returns `true` if the request is allowed (and records it), `false` if the
 * limit has been reached.
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  return limiter.check(key, limit, windowMs);
}

/**
 * Rate limiting middleware factory
 */
export function rateLimitMiddleware(options: { limit: number; windowMs: number }) {
  return async (c: Context, next: Next) => {
    const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";
    const key = `${ip}:${c.req.path}`;

    const allowed = limiter.check(key, options.limit, options.windowMs);

    if (!allowed) {
      return c.json(
        {
          success: false,
          error: "Too many requests - please try again later",
        },
        429
      );
    }

    await next();
  };
}
