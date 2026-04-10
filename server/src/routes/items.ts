import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { createItemSchema, updateItemSchema, itemLocationSchema } from "@pantrymaid/shared/schemas";
import { authMiddleware, getUser } from "../middleware/auth";
import { db } from "../lib/db";
import { items as itemsTable } from "../db/schema";
import { eq, and, count } from "drizzle-orm";
import { z } from "zod";

const items = new Hono();

// All items routes require authentication
items.use("*", authMiddleware);

/**
 * POST /items - Create a new item
 */
items.post(
  "/",
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  zValidator("json", createItemSchema),
  async (c) => {
    try {
      const user = getUser(c);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const data = c.req.valid("json");

      if (!user.householdId) {
        return c.json(
          {
            success: false,
            error: "User must belong to a household to create items",
          },
          403
        );
      }

      // Create item in database
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      const insertData = {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        ...data,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        quantity: String(data.quantity),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        expirationDate: data.expirationDate instanceof Date
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          ? data.expirationDate.toISOString().split('T')[0]
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          : data.expirationDate,
        householdId: user.householdId,
        addedBy: user.id,
      };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      const [item] = await db.insert(itemsTable).values(insertData as never).returning();

      return c.json({
        success: true,
        data: item,
      }, 201);
    } catch (error) {
      console.error("Error creating item:", error);
      return c.json(
        {
          success: false,
          error: "Failed to create item",
        },
        500
      );
    }
  }
);

/**
 * GET /items - List items (with optional location filter)
 */
items.get(
  "/",
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  zValidator("query", z.object({
    location: itemLocationSchema.optional(),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(50),
  })),
  async (c) => {
    try {
      const user = getUser(c);
      const { location: _location, page, pageSize } = c.req.valid("query");

      if (!user.householdId) {
        return c.json({
          success: true,
          data: {
            items: [],
            total: 0,
            page,
            pageSize,
          },
        });
      }

      // Household isolation: WHERE householdId = user.householdId
      // Location filter: AND location = location (if provided)
      const conditions = [eq(itemsTable.householdId, user.householdId)];
      if (_location) {
        conditions.push(eq(itemsTable.location, _location));
      }

      const itemsList = await db.select().from(itemsTable)
        .where(and(...conditions))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      // Get total count
      const [countResult] = await db.select({ count: count() }).from(itemsTable)
        .where(and(...conditions));
      const total = countResult ? Number(countResult.count) : 0;

      return c.json({
        success: true,
        data: {
          items: itemsList,
          total,
          page,
          pageSize,
        },
      });
    } catch (error) {
      console.error("Error fetching items:", error);
      return c.json(
        {
          success: false,
          error: "Failed to fetch items",
        },
        500
      );
    }
  }
);

/**
 * GET /items/:id - Get item detail
 */
items.get("/:id", async (c) => {
  try {
    const user = getUser(c);
    const itemId = c.req.param("id");

    if (!user.householdId) {
      return c.json(
        {
          success: false,
          error: "User must belong to a household",
        },
        403
      );
    }

    // IDOR prevention: WHERE id = itemId AND householdId = user.householdId
    const [item] = await db.select().from(itemsTable)
      .where(and(
        eq(itemsTable.id, itemId),
        eq(itemsTable.householdId, user.householdId)
      ));

    if (!item) {
      return c.json({ success: false, error: "Item not found" }, 404);
    }

    return c.json({
      success: true,
      data: item,
    });
  } catch (error) {
    console.error("Error fetching item:", error);
    return c.json(
      {
        success: false,
        error: "Failed to fetch item",
      },
      500
    );
  }
});

/**
 * PUT /items/:id - Update item
 */
items.put(
  "/:id",
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  zValidator("json", updateItemSchema),
  async (c) => {
    try {
      const user = getUser(c);
      const itemId = c.req.param("id");
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const updates = c.req.valid("json");

      if (!user.householdId) {
        return c.json(
          {
            success: false,
            error: "User must belong to a household",
          },
          403
        );
      }

      // IDOR prevention: WHERE id = itemId AND householdId = user.householdId
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      const updateData = {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        ...updates,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        quantity: updates.quantity !== undefined ? String(updates.quantity) : undefined,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        expirationDate: updates.expirationDate instanceof Date
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          ? updates.expirationDate.toISOString().split('T')[0]
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          : updates.expirationDate,
        updatedAt: new Date(),
      };
      const [item] = await db.update(itemsTable)
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        .set(updateData as never)
        .where(and(
          eq(itemsTable.id, itemId),
          eq(itemsTable.householdId, user.householdId)
        ))
        .returning();

      if (!item) {
        return c.json({ success: false, error: "Item not found" }, 404);
      }

      return c.json({
        success: true,
        data: item,
      });
    } catch (error) {
      console.error("Error updating item:", error);
      return c.json(
        {
          success: false,
          error: "Failed to update item",
        },
        500
      );
    }
  }
);

/**
 * DELETE /items/:id - Delete item
 */
items.delete("/:id", async (c) => {
  try {
    const user = getUser(c);
    const itemId = c.req.param("id");

    if (!user.householdId) {
      return c.json(
        {
          success: false,
          error: "User must belong to a household",
        },
        403
      );
    }

    // IDOR prevention: WHERE id = itemId AND householdId = user.householdId
    const result = await db.delete(itemsTable)
      .where(and(
        eq(itemsTable.id, itemId),
        eq(itemsTable.householdId, user.householdId)
      ))
      .returning();

    if (result.length === 0) {
      return c.json({ success: false, error: "Item not found" }, 404);
    }

    return c.json({
      success: true,
      data: null,
    });
  } catch (error) {
    console.error("Error deleting item:", error);
    return c.json(
      {
        success: false,
        error: "Failed to delete item",
      },
      500
    );
  }
});

export default items;
