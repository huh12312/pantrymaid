import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { createHouseholdSchema } from "@pantrymaid/shared/schemas";
import { authMiddleware, getUser } from "../middleware/auth";
// import { db } from "../lib/db"; // TODO: Uncomment when DB schema is ready
import { z } from "zod";

const households = new Hono();

// All household routes require authentication
households.use("*", authMiddleware);

/**
 * Generate a random invite code
 */
function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // No ambiguous chars
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/**
 * POST /households - Create a new household
 */
households.post(
  "/",
  zValidator("json", createHouseholdSchema),
  async (c) => {
    try {
      const user = getUser(c);
      const data = c.req.valid("json");

      // Check if user already has a household
      if (user.householdId) {
        return c.json(
          {
            success: false,
            error: "User already belongs to a household",
          },
          400
        );
      }

      const inviteCode = generateInviteCode();

      // TODO: Replace with actual DB operations when schema is ready
      // const [household] = await db.insert(householdsTable).values({
      //   id: crypto.randomUUID(),
      //   name: data.name,
      //   inviteCode,
      //   createdAt: new Date(),
      // }).returning();

      // Update user's household association
      // await db.update(usersTable)
      //   .set({ householdId: household.id })
      //   .where(eq(usersTable.id, user.id));

      const household = {
        id: crypto.randomUUID(),
        name: data.name,
        inviteCode,
        createdAt: new Date(),
      };

      return c.json({
        success: true,
        data: household,
      }, 201);
    } catch (error) {
      console.error("Error creating household:", error);
      return c.json(
        {
          success: false,
          error: "Failed to create household",
        },
        500
      );
    }
  }
);

/**
 * GET /households/:id - Get household details (with members)
 */
households.get("/:id", async (c) => {
  try {
    const user = getUser(c);
    const householdId = c.req.param("id");

    // IDOR prevention: User can only access their own household
    if (user.householdId !== householdId) {
      return c.json(
        {
          success: false,
          error: "Access denied - not a member of this household",
        },
        403
      );
    }

    // TODO: Replace with actual DB query when schema is ready
    // const [household] = await db.select().from(householdsTable)
    //   .where(eq(householdsTable.id, householdId));

    // if (!household) {
    //   return c.json({ success: false, error: "Household not found" }, 404);
    // }

    // Get household members
    // const members = await db.select({
    //   id: usersTable.id,
    //   displayName: usersTable.displayName,
    //   email: usersTable.email,
    //   createdAt: usersTable.createdAt,
    // }).from(usersTable)
    //   .where(eq(usersTable.householdId, householdId));

    return c.json({
      success: false,
      error: "Household not found - DB schema not yet implemented",
    }, 404);
  } catch (error) {
    console.error("Error fetching household:", error);
    return c.json(
      {
        success: false,
        error: "Failed to fetch household",
      },
      500
    );
  }
});

/**
 * POST /households/:id/members - Invite user to household via invite code
 */
households.post(
  "/:id/members",
  zValidator("json", z.object({
    inviteCode: z.string().min(8).max(8),
  })),
  async (c) => {
    try {
      const user = getUser(c);
      // @ts-ignore - Will be used when DB schema is ready
      const _householdId = c.req.param("id");
      // @ts-ignore - Will be used when DB schema is ready
      const { inviteCode: _inviteCode } = c.req.valid("json");

      // Check if user already has a household
      if (user.householdId) {
        return c.json(
          {
            success: false,
            error: "User already belongs to a household",
          },
          400
        );
      }

      // TODO: Replace with actual DB operations when schema is ready
      // Verify invite code matches household
      // const [household] = await db.select().from(householdsTable)
      //   .where(and(
      //     eq(householdsTable.id, householdId),
      //     eq(householdsTable.inviteCode, inviteCode)
      //   ));

      // if (!household) {
      //   return c.json({ success: false, error: "Invalid invite code" }, 400);
      // }

      // Add user to household
      // await db.update(usersTable)
      //   .set({ householdId })
      //   .where(eq(usersTable.id, user.id));

      return c.json({
        success: false,
        error: "Invite not implemented - DB schema not yet ready",
      }, 404);
    } catch (error) {
      console.error("Error joining household:", error);
      return c.json(
        {
          success: false,
          error: "Failed to join household",
        },
        500
      );
    }
  }
);

export default households;
