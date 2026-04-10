import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { auth, createUserHousehold } from "./lib/auth";
import { rateLimitMiddleware } from "./middleware/ratelimit";

// Import routes
import items from "./routes/items";
import households from "./routes/households";
import barcode from "./routes/barcode";
import receipt from "./routes/receipt";

const app = new Hono();

// Global middleware
app.use("*", logger());
app.use("*", secureHeaders());

// CORS configuration
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:8081",
  process.env.BETTER_AUTH_URL || "",
];

app.use(
  "*",
  cors({
    origin: (origin) => {
      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin) return "*";
      // Reject unlisted origins
      return allowedOrigins.includes(origin) ? origin : null;
    },
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  })
);

// Rate limiting on auth routes (5 req/min)
app.use(
  "/api/auth/*",
  rateLimitMiddleware({
    limit: 5,
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

// Better Auth routes (public) - with detailed error logging
app.on(["POST", "GET"], "/api/auth/**", async (c) => {
  try {
    const request = c.req.raw;
    const url = new URL(request.url);

    console.log("Better Auth request:", {
      method: request.method,
      path: url.pathname,
      origin: request.headers.get("origin"),
      referer: request.headers.get("referer"),
      host: request.headers.get("host"),
      userAgent: request.headers.get("user-agent"),
    });

    // Call Better Auth handler
    const response = await auth.handler(request);

    console.log("Better Auth response:", {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers),
    });

    // After successful sign-up, create a household for the new user
    if (url.pathname === "/api/auth/sign-up/email" && request.method === "POST" && response.status === 200) {
      try {
        // Clone the response to read the body
        const clonedResponse = response.clone();
        const data = await clonedResponse.json() as { user?: { id: string; name: string } };

        if (data.user?.id) {
          // Wait for household creation to complete before returning
          await createUserHousehold(data.user.id, data.user.name);
        }
      } catch (error) {
        console.error("Error in sign-up post-processing:", error);
        // Don't fail the sign-up if household creation fails
      }
    }

    return response;
  } catch (error) {
    console.error("Better Auth handler error:", error);
    console.error("Error stack:", error instanceof Error ? error.stack : "No stack");
    console.error("Request details:", {
      method: c.req.method,
      path: c.req.path,
      url: c.req.url,
      headers: Object.fromEntries(c.req.raw.headers),
    });
    return c.json({ success: false, error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

// API routes (protected)
app.route("/api/items", items);
app.route("/api/households", households);
app.route("/api/barcode", barcode);
app.route("/api/receipt", receipt);

// 404 handler
app.notFound((c) => {
  return c.json(
    {
      success: false,
      error: "Route not found",
    },
    404
  );
});

// Error handler
app.onError((err, c) => {
  console.error("App error:", {
    message: err.message,
    stack: err.stack,
    path: c.req.path,
    method: c.req.method,
    headers: Object.fromEntries(c.req.raw.headers),
  });
  return c.json(
    {
      success: false,
      error: process.env.NODE_ENV === "production"
        ? "Internal server error"
        : err.message,
    },
    500
  );
});

const port = parseInt(process.env.PORT || "3000");

console.log(`🚀 Server starting on port ${port}`);
console.log(`📝 Environment: ${process.env.NODE_ENV || "development"}`);
console.log(`🔐 Auth endpoint: /api/auth/*`);
console.log(`📦 API endpoints: /api/items, /api/households, /api/barcode, /api/receipt`);

export default {
  port,
  fetch: app.fetch,
};
