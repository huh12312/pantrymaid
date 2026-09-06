import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { serveStatic } from "hono/bun";
import { auth, createUserHousehold, joinHouseholdByCode } from "./lib/auth";
import { rateLimitMiddleware } from "./middleware/ratelimit";
import { client, db } from "./lib/db";
import { runMigrations } from "./lib/migrate";
import { logMealPlanKekBootStatus } from "./lib/crypto";
import { households as householdsTable } from "./db/schema";
import { eq } from "drizzle-orm";

// Import routes
import items from "./routes/items";
import households from "./routes/households";
import barcode from "./routes/barcode";
import receipt from "./routes/receipt";
import shoppingList from "./routes/shopping-list";
import products from "./routes/products";
import stores from "./routes/stores";
import housesRoute from "./routes/houses";
import settings from "./routes/settings";
import mealPlans from "./routes/meal-plans";
import { sweepStalePlans } from "./lib/mealplan/generate";

const app = new Hono();

// Global middleware
app.use("*", logger());
app.use("*", secureHeaders());

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  })
);

// Rate limiting on auth routes (strict in production only)
app.use(
  "/api/auth/*",
  rateLimitMiddleware({
    limit: process.env.NODE_ENV === "production" ? 5 : 100,
    windowMs: 60 * 1000, // 1 minute
  })
);

// Health check (public)
app.get("/health", (c) => {
  return c.json({
    success: true,
    data: {
      status: "ok",
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || "development",
    },
  });
});

// Public config endpoint — returns runtime feature flags to the frontend
app.get("/api/config", (c) => {
  return c.json({
    signupEnabled: process.env.SIGNUP_ENABLED !== "false",
  });
});

// Better Auth routes (public)
app.on(["POST", "GET"], "/api/auth/*", async (c) => {
  try {
    const request = c.req.raw;
    const url = new URL(request.url);

    // Block signup when SIGNUP_ENABLED=false
    if (
      url.pathname === "/api/auth/sign-up/email" &&
      request.method === "POST" &&
      process.env.SIGNUP_ENABLED === "false"
    ) {
      return c.json({ error: "Sign up is currently disabled." }, 403);
    }

    const isSignUp = url.pathname === "/api/auth/sign-up/email" && request.method === "POST";

    // Read invite code from request body before passing to Better Auth.
    // Clone the request so Better Auth still gets an unread body stream.
    let pendingInviteCode: string | null = null;
    let authRequest = request;
    if (isSignUp) {
      const bodyText = await request.clone().text();
      try {
        const body = JSON.parse(bodyText) as Record<string, unknown>;
        if (typeof body.inviteCode === "string" && body.inviteCode.trim()) {
          pendingInviteCode = body.inviteCode.trim().toUpperCase();
        }
      } catch {
        /* non-JSON body — ignore */
      }
      // Rebuild the request so Better Auth sees the original body
      authRequest = new Request(request, { body: bodyText });
    }

    const response = await auth.handler(authRequest);

    // Log non-2xx auth responses to aid production debugging
    if (!response.ok && url.pathname.startsWith("/api/auth/")) {
      const body = await response.clone().text();
      console.error(`Auth error [${response.status}] ${url.pathname}: ${body}`);
    }

    // After successful sign-up, join or create a household for the new user
    if (isSignUp && response.status === 200) {
      try {
        const data = (await response.clone().json()) as { user?: { id: string; name: string } };

        if (data.user?.id) {
          if (pendingInviteCode) {
            const joined = await joinHouseholdByCode(
              data.user.id,
              pendingInviteCode,
              data.user.name
            );
            if (!joined) {
              // Code was invalid — fall back to creating a household so the user isn't orphaned
              console.warn(
                `Invite code ${pendingInviteCode} not found; creating default household`
              );
              await createUserHousehold(data.user.id, data.user.name);
            }
          } else {
            await createUserHousehold(data.user.id, data.user.name);
          }
        }
      } catch (error) {
        console.error("Error in sign-up post-processing:", error);
      }
    }

    return response;
  } catch (error) {
    console.error("Better Auth handler error:", error);
    console.error("Error stack:", error instanceof Error ? error.stack : "No stack");
    console.error("Request details:", { method: c.req.method, path: c.req.path });
    return c.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      500
    );
  }
});

// Public: check whether an invite code is valid (used during sign-up join flow)
app.get("/api/households/validate-invite", async (c) => {
  const code = (c.req.query("code") ?? "").trim().toUpperCase();
  if (code.length !== 8) {
    return c.json({ valid: false, error: "Code must be 8 characters" }, 400);
  }
  const [household] = await db
    .select({ id: householdsTable.id, name: householdsTable.name })
    .from(householdsTable)
    .where(eq(householdsTable.inviteCode, code));
  if (!household) return c.json({ valid: false });
  return c.json({ valid: true, householdName: household.name });
});

// API routes (protected)
app.route("/api/items", items);
app.route("/api/households", households);
app.route("/api/barcode", barcode);
app.route("/api/receipt", receipt);
app.route("/api/shopping-list", shoppingList);
app.route("/api/products", products);
app.route("/api/stores", stores);
app.route("/api/houses", housesRoute);
app.route("/api/settings", settings);
app.route("/api/meal-plans", mealPlans);

// Serve web app static files — API routes above take precedence
app.use("/*", serveStatic({ root: "./public" }));
// SPA fallback: any unmatched route serves index.html for React Router
app.get("/*", serveStatic({ path: "./public/index.html" }));

// 404 handler (only reached for unmatched non-GET API requests)
app.notFound((c) => {
  return c.json(
    {
      success: false,
      error: "Route not found",
    },
    404
  );
});

// Headers that must never be written to logs (auth credentials)
const REDACTED_HEADERS = new Set(["authorization", "cookie"]);

function redactHeaders(headers: Headers): Record<string, string> {
  return Object.fromEntries(
    Array.from(headers.entries()).map(([key, value]) => [
      key,
      REDACTED_HEADERS.has(key.toLowerCase()) ? "[redacted]" : value,
    ])
  );
}

// Error handler
app.onError((err, c) => {
  console.error("App error:", {
    message: err.message,
    stack: err.stack,
    path: c.req.path,
    method: c.req.method,
    headers: redactHeaders(c.req.raw.headers),
  });
  return c.json(
    {
      success: false,
      error: "Internal server error",
    },
    500
  );
});

// Run migrations before accepting requests
console.log("⏳ Running database migrations...");
try {
  // Absolute path — works regardless of cwd (import.meta.dir = server/src)
  await runMigrations(client, `${import.meta.dir}/../drizzle`);
  console.log("✓ Migrations complete");
} catch (err) {
  console.error("✗ Migration failed:", err);
  process.exit(1);
}

// Validate MEAL_PLAN_KEK before accepting requests (self-diagnosing operator
// misconfiguration — see logMealPlanKekBootStatus's doc comment for the incident this
// fixes). Unlike the migration check above, this deliberately never calls
// process.exit: meal planning is one feature among several (inventory, barcode,
// receipts), and a bad/missing KEK must fail only that feature, not the whole app.
logMealPlanKekBootStatus();

// Crash sweep (plan §4.1): a single Bun process means in-flight generation jobs die
// with the process, with no queue to resume them. Any `generating_*` meal plan whose
// heartbeat has gone stale is failed with error_code='interrupted' — at boot, and
// again every 60s so a mid-life crash doesn't leave a household's `one_active` slot
// wedged forever.
try {
  const sweptAtBoot = await sweepStalePlans();
  if (sweptAtBoot > 0) {
    console.log(`⏳ Swept ${sweptAtBoot} stale meal plan(s) at boot`);
  }
} catch (err) {
  console.error("Meal plan boot sweep failed:", err);
}
setInterval(() => {
  sweepStalePlans().catch((err) => console.error("Meal plan sweep failed:", err));
}, 60 * 1000);

const port = parseInt(process.env.PORT || "3000");

console.log(`🚀 Server starting on port ${port}`);
console.log(`📝 Environment: ${process.env.NODE_ENV || "development"}`);
console.log(`🔐 Auth endpoint: /api/auth/*`);
console.log(`📦 API endpoints: /api/items, /api/households, /api/barcode, /api/receipt`);

export default {
  port,
  fetch: app.fetch,
};
