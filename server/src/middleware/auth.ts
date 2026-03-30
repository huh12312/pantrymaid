import { Context, Next } from "hono";
import { auth } from "../lib/auth";

/**
 * Auth middleware context extension
 */
export interface AuthContext {
  user: {
    id: string;
    householdId?: string;
    email: string;
  };
}

/**
 * Middleware to verify JWT and inject user context
 * Uses Better Auth for JWT validation
 */
export async function authMiddleware(c: Context, next: Next) {
  try {
    // Get the session from Better Auth
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });

    if (!session || !session.user) {
      return c.json(
        {
          success: false,
          error: "Unauthorized - Invalid or missing token",
        },
        401
      );
    }

    // Inject user context into request
    c.set("user", {
      id: session.user.id,
      householdId: (session.user as any).householdId,
      email: session.user.email,
    });

    await next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    return c.json(
      {
        success: false,
        error: "Unauthorized - Token verification failed",
      },
      401
    );
  }
}

/**
 * Helper to get user from context
 */
export function getUser(c: Context): AuthContext["user"] {
  const user = c.get("user");
  if (!user) {
    throw new Error("User not found in context - did you forget auth middleware?");
  }
  return user;
}
