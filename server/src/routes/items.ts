import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { createItemSchema, updateItemSchema, itemLocationSchema } from "@pantrymaid/shared/schemas";
import type { CreateItemInput, UpdateItemInput } from "@pantrymaid/shared/schemas";
import { authMiddleware, getUser } from "../middleware/auth";
import { db } from "../lib/db";
import { items as itemsTable, houses as housesTable } from "../db/schema";
import { eq, and, asc } from "drizzle-orm";
import { z } from "zod";
import { resolveImageForItem } from "../lib/imageresolver";
import { suggestItemDefaults } from "../lib/openai";

// Normalize DB rows: quantity is stored as numeric string, coerce to number
function serializeItem(item: typeof itemsTable.$inferSelect) {
  return { ...item, quantity: Number(item.quantity) };
}

const items = new Hono();

// All items routes require authentication
items.use("*", authMiddleware);

/**
 * POST /items - Create a new item
 */
items.post("/", zValidator("json", createItemSchema), async (c) => {
  try {
    const user = getUser(c);
    const data = c.req.valid("json") as CreateItemInput;

    if (!user.householdId) {
      return c.json(
        {
          success: false,
          error: "User must belong to a household to create items",
        },
        403
      );
    }

    // Validate houseId belongs to this household (if provided)
    let resolvedHouseId: string | null = null;
    if (data.houseId) {
      const [house] = await db
        .select({ id: housesTable.id })
        .from(housesTable)
        .where(
          and(eq(housesTable.id, data.houseId), eq(housesTable.householdId, user.householdId))
        );
      if (!house) {
        return c.json({ success: false, error: "House not found" }, 400);
      }
      resolvedHouseId = house.id;
    } else {
      // Default to the household's first house
      const [first] = await db
        .select({ id: housesTable.id })
        .from(housesTable)
        .where(eq(housesTable.householdId, user.householdId))
        .orderBy(housesTable.createdAt)
        .limit(1);
      resolvedHouseId = first?.id ?? null;
    }

    const insertData: typeof itemsTable.$inferInsert = {
      name: data.name,
      brand: data.brand,
      category: data.category,
      location: data.location,
      quantity: String(data.quantity),
      unit: data.unit,
      barcodeUpc: data.barcodeUpc,
      imageUrl: data.imageUrl,
      expirationDate:
        data.expirationDate instanceof Date
          ? data.expirationDate.toISOString().split("T")[0]
          : (data.expirationDate ?? null),
      expirationEstimated: data.expirationEstimated ?? false,
      notes: data.notes,
      householdId: user.householdId,
      houseId: resolvedHouseId,
      addedBy: user.id,
    };
    const [created] = await db.insert(itemsTable).values(insertData).returning();

    if (!created) {
      return c.json({ success: false, error: "Failed to create item" }, 500);
    }

    void resolveImageForItem(
      created.id,
      created.name,
      created.barcodeUpc ?? null,
      created.imageUrl ?? null,
      created.category ?? null,
      user.householdId
    ).catch((err) => console.error("Image resolve failed for item", created.id, err));

    return c.json(
      {
        success: true,
        data: serializeItem(created),
      },
      201
    );
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
});

/**
 * GET /items - List items (with optional location filter)
 */
items.get(
  "/",
  zValidator(
    "query",
    z.object({
      location: itemLocationSchema.optional(),
      houseId: z.string().uuid().optional(),
    })
  ),
  async (c) => {
    try {
      const user = getUser(c);
      const { location, houseId } = c.req.valid("query");

      if (!user.householdId) {
        return c.json({
          success: true,
          data: { items: [] },
        });
      }

      const conditions = [eq(itemsTable.householdId, user.householdId)];
      if (houseId) {
        conditions.push(eq(itemsTable.houseId, houseId));
      }
      if (location) {
        conditions.push(eq(itemsTable.location, location));
      }

      const itemsList = await db
        .select()
        .from(itemsTable)
        .where(and(...conditions))
        .orderBy(asc(itemsTable.name));

      return c.json({
        success: true,
        data: { items: itemsList.map(serializeItem) },
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
    const [item] = await db
      .select()
      .from(itemsTable)
      .where(and(eq(itemsTable.id, itemId), eq(itemsTable.householdId, user.householdId)));

    if (!item) {
      return c.json({ success: false, error: "Item not found" }, 404);
    }

    return c.json({
      success: true,
      data: serializeItem(item),
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
 * PATCH /items/:id - Partially update item
 */
items.patch("/:id", zValidator("json", updateItemSchema), async (c) => {
  try {
    const user = getUser(c);
    const itemId = c.req.param("id");
    const updates = c.req.valid("json") as UpdateItemInput;

    if (!user.householdId) {
      return c.json(
        {
          success: false,
          error: "User must belong to a household",
        },
        403
      );
    }

    const updateData: Partial<typeof itemsTable.$inferInsert> & { updatedAt: Date } = {
      ...updates,
      quantity: updates.quantity !== undefined ? String(updates.quantity) : undefined,
      expirationDate:
        updates.expirationDate instanceof Date
          ? updates.expirationDate.toISOString().split("T")[0]
          : updates.expirationDate,
      updatedAt: new Date(),
    };
    const [item] = await db
      .update(itemsTable)
      .set(updateData)
      .where(and(eq(itemsTable.id, itemId), eq(itemsTable.householdId, user.householdId)))
      .returning();

    if (!item) {
      return c.json({ success: false, error: "Item not found" }, 404);
    }

    return c.json({
      success: true,
      data: serializeItem(item),
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
});

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
    const result = await db
      .delete(itemsTable)
      .where(and(eq(itemsTable.id, itemId), eq(itemsTable.householdId, user.householdId)))
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

// POST /items/suggest — AI-powered field suggestions for a named item
items.post("/suggest", zValidator("json", z.object({ name: z.string().min(1) })), async (c) => {
  try {
    const user = getUser(c);
    const { name } = c.req.valid("json");
    const suggestion = await suggestItemDefaults(name, user.householdId);
    return c.json({ success: true, data: suggestion });
  } catch (error) {
    console.error("Error suggesting item defaults:", error);
    return c.json({ success: false, error: "Suggestion unavailable" }, 503);
  }
});

export default items;
