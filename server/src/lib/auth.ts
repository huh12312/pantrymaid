import { betterAuth } from "better-auth";
import { db } from "./db";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { households as householdsTable, users } from "../db/schema";

/**
 * Generate a cryptographically secure random invite code
 */
export function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // No ambiguous chars
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);

  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars[bytes[i]! % chars.length];
  }
  return code;
}

/**
 * Create a default household for a new user
 */
export async function createUserHousehold(userId: string, userName: string): Promise<void> {
  try {
    // Create a default household for the new user
    const inviteCode = generateInviteCode();
    const [household] = await db.insert(householdsTable).values({
      name: `${userName}'s Household`,
      inviteCode,
    }).returning();

    if (household) {
      // Link the user to the household in the application's users table
      await db.insert(users).values({
        id: userId,
        householdId: household.id,
        displayName: userName,
      });

      console.log(`✓ Created household ${household.id} for user ${userId}`);
    }
  } catch (error) {
    console.error("Failed to create household for new user:", error);
    throw error;
  }
}

// Initialize Better Auth with Drizzle adapter
const trustedOrigins = [
  "http://localhost:5173",    // Frontend origin
  "http://localhost:3000",    // Backend origin (for proxied requests)
  "http://localhost:8081",    // Mobile origin
  process.env.BETTER_AUTH_URL || "",
].filter(Boolean);

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
  }),
  emailAndPassword: {
    enabled: true,
  },
  trustedOrigins,
  secret: process.env.BETTER_AUTH_SECRET,
});

export type AuthSession = typeof auth.$Infer.Session;
