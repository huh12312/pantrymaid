import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { createItemSchema, updateItemSchema, itemLocationSchema } from "@pantrymaid/shared/schemas";
import { authMiddleware, getUser } from "../middleware/auth";
// import { db } from "../lib/db"; // TODO: Uncomment when DB schema is ready
import { z } from "zod";

const items = new Hono();

// All items routes require authentication
items.use("*", authMiddleware);

/**
 * POST /items - Create a new item
 */
items.post(
  "/",
  zValidator("json", createItemSchema),
  async (c) => {
    try {
      const user = getUser(c);
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
      // Note: Actual DB operations will be implemented once Agent 2 completes the schema
      const newItem = {
        id: crypto.randomUUID(),
        householdId: user.householdId,
        ...data,
        addedBy: user.id,
        addedAt: new Date(),
        updatedAt: new Date(),
      };

      // TODO: Replace with actual DB insert when schema is ready
      // const [item] = await db.insert(itemsTable).values(newItem).returning();

      return c.json({
        success: true,
        data: newItem,
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

      // TODO: Replace with actual DB query when schema is ready
      // Household isolation: WHERE householdId = user.householdId
      // Location filter: AND location = location (if provided)
      // const items = await db.select().from(itemsTable)
      //   .where(eq(itemsTable.householdId, user.householdId))
      //   .limit(pageSize)
      //   .offset((page - 1) * pageSize);

      return c.json({
        success: true,
        data: {
          items: [],
          total: 0,
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
    // @ts-ignore - Will be used when DB schema is ready
    const _itemId = c.req.param("id");

    if (!user.householdId) {
      return c.json(
        {
          success: false,
          error: "User must belong to a household",
        },
        403
      );
    }

    // TODO: Replace with actual DB query when schema is ready
    // IDOR prevention: WHERE id = itemId AND householdId = user.householdId
    // const [item] = await db.select().from(itemsTable)
    //   .where(and(
    //     eq(itemsTable.id, itemId),
    //     eq(itemsTable.householdId, user.householdId)
    //   ));

    // if (!item) {
    //   return c.json({ success: false, error: "Item not found" }, 404);
    // }

    return c.json({
      success: false,
      error: "Item not found - DB schema not yet implemented",
    }, 404);
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
  zValidator("json", updateItemSchema),
  async (c) => {
    try {
      const user = getUser(c);
      // @ts-ignore - Will be used when DB schema is ready
      const _itemId = c.req.param("id");
      // @ts-ignore - Will be used when DB schema is ready
      const _updates = c.req.valid("json");

      if (!user.householdId) {
        return c.json(
          {
            success: false,
            error: "User must belong to a household",
          },
          403
        );
      }

      // TODO: Replace with actual DB update when schema is ready
      // IDOR prevention: WHERE id = itemId AND householdId = user.householdId
      // const [item] = await db.update(itemsTable)
      //   .set({ ...updates, updatedAt: new Date() })
      //   .where(and(
      //     eq(itemsTable.id, itemId),
      //     eq(itemsTable.householdId, user.householdId)
      //   ))
      //   .returning();

      // if (!item) {
      //   return c.json({ success: false, error: "Item not found" }, 404);
      // }

      return c.json({
        success: false,
        error: "Update not implemented - DB schema not yet ready",
      }, 404);
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
    // @ts-ignore - Will be used when DB schema is ready
    const _itemId = c.req.param("id");

    if (!user.householdId) {
      return c.json(
        {
          success: false,
          error: "User must belong to a household",
        },
        403
      );
    }

    // TODO: Replace with actual DB delete when schema is ready
    // IDOR prevention: WHERE id = itemId AND householdId = user.householdId
    // const result = await db.delete(itemsTable)
    //   .where(and(
    //     eq(itemsTable.id, itemId),
    //     eq(itemsTable.householdId, user.householdId)
    //   ))
    //   .returning();

    // if (result.length === 0) {
    //   return c.json({ success: false, error: "Item not found" }, 404);
    // }

    return c.json({
      success: false,
      error: "Delete not implemented - DB schema not yet ready",
    }, 404);
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
