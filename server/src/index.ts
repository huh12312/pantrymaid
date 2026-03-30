import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { auth } from "./lib/auth";
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
      // Check if origin is in allowed list
      return allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
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

// Better Auth routes (public)
app.on(["POST", "GET"], "/api/auth/**", (c) => {
  return auth.handler(c.req.raw);
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
  console.error("Unhandled error:", err);
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
