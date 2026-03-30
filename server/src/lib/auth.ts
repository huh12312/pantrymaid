import { betterAuth } from "better-auth";
import { db } from "./db";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

// Initialize Better Auth with Drizzle adapter
export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
  }),
  emailAndPassword: {
    enabled: true,
  },
  trustedOrigins: [
    "http://localhost:5173",
    "http://localhost:8081",
    process.env.BETTER_AUTH_URL || "",
  ],
  secret: process.env.BETTER_AUTH_SECRET,
});

export type AuthSession = typeof auth.$Infer.Session;
