/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import {
  setupTestDb,
  teardownTestDb,
  clearTables,
  testDb,
  createTestSession,
  createAuthUserRow,
} from "../setup";
import { factories } from "../factories";
import { households, users, items } from "../../db/schema";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import itemsRoute from "../../routes/items";

describe("Items API Routes", () => {
  let app: Hono;
  let testHousehold: ReturnType<typeof factories.household>;
  let testUser: ReturnType<typeof factories.user>;
  let authCookie: string;

  beforeAll(async () => {
    await setupTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await clearTables();

    // Create test household and a real Better Auth session for the primary user
    testHousehold = factories.household();
    const session = await createTestSession();
    testUser = factories.user(testHousehold.id, { id: session.id, displayName: session.name });

    await testDb.insert(households).values(testHousehold);
    await testDb.insert(users).values(testUser);

    authCookie = session.cookie;

    // Setup app with routes
    app = new Hono();
    app.route("/items", itemsRoute);
  });

  describe("POST /items", () => {
    it("should create a new item and return 201 with item data", async () => {
      const newItem = {
        name: "Whole Milk",
        brand: "Great Value",
        category: "Dairy",
        location: "fridge" as const,
        quantity: 1,
        unit: "gallon",
        barcodeUpc: "041220000000",
        expirationDate: new Date("2024-12-31"),
        expirationEstimated: false,
        notes: "Organic whole milk",
      };

      const response = await app.request("/items", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: authCookie,
        },
        body: JSON.stringify(newItem),
      });

      expect(response.status).toBe(201);

      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.data).toMatchObject({
        name: "Whole Milk",
        brand: "Great Value",
        category: "Dairy",
        location: "fridge",
        householdId: testHousehold.id,
        addedBy: testUser.id,
      });
      expect(json.data.id).toBeDefined();
      expect(json.data.addedAt).toBeDefined();
      expect(json.data.updatedAt).toBeDefined();

      // Verify item was inserted into database
      const [insertedItem] = await testDb.select().from(items).where(eq(items.id, json.data.id));

      expect(insertedItem).toBeDefined();
      expect(insertedItem.name).toBe("Whole Milk");
    });

    it("should fail without authentication", async () => {
      const newItem = {
        name: "Test Item",
        location: "pantry" as const,
      };

      const response = await app.request("/items", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(newItem),
      });

      expect(response.status).toBe(401);
    });

    it("should fail with invalid data", async () => {
      const invalidItem = {
        name: "", // Empty name should fail validation
        location: "invalid_location", // Invalid location
      };

      const response = await app.request("/items", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: authCookie,
        },
        body: JSON.stringify(invalidItem),
      });

      expect(response.status).toBe(400);
    });
  });

  describe("GET /items", () => {
    it("should return array of items for household", async () => {
      // Create some test items
      const testItems = factories.items(testHousehold.id, testUser.id, 5);
      await testDb.insert(items).values(testItems);

      const response = await app.request("/items", {
        method: "GET",
        headers: {
          Cookie: authCookie,
        },
      });

      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.data.items).toHaveLength(5);
      expect(json.data.total).toBe(5);
      expect(json.data.page).toBe(1);
      expect(json.data.pageSize).toBe(50);

      // Verify all items belong to the household
      json.data.items.forEach((item: any) => {
        expect(item.householdId).toBe(testHousehold.id);
      });
    });

    it("should filter items by location", async () => {
      // Create items in different locations
      await testDb
        .insert(items)
        .values([
          factories.item(testHousehold.id, testUser.id, { location: "pantry" }),
          factories.item(testHousehold.id, testUser.id, { location: "fridge" }),
          factories.item(testHousehold.id, testUser.id, { location: "fridge" }),
          factories.item(testHousehold.id, testUser.id, { location: "freezer" }),
        ]);

      const response = await app.request("/items?location=fridge", {
        method: "GET",
        headers: {
          Cookie: authCookie,
        },
      });

      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.data.items).toHaveLength(2);
      json.data.items.forEach((item: any) => {
        expect(item.location).toBe("fridge");
      });
    });

    it("should not return items from other households", async () => {
      // Create another household with items
      const otherHousehold = factories.household();
      await testDb.insert(households).values(otherHousehold);
      const otherAuthUser = await createAuthUserRow();
      const otherUser = factories.user(otherHousehold.id, { id: otherAuthUser.id });
      await testDb.insert(users).values(otherUser);
      await testDb.insert(items).values(factories.items(otherHousehold.id, otherUser.id, 3));

      // Create items for test household
      await testDb.insert(items).values(factories.items(testHousehold.id, testUser.id, 2));

      const response = await app.request("/items", {
        method: "GET",
        headers: {
          Cookie: authCookie,
        },
      });

      const json = await response.json();
      expect(json.data.items).toHaveLength(2);
      json.data.items.forEach((item: any) => {
        expect(item.householdId).toBe(testHousehold.id);
      });
    });

    it("should support pagination", async () => {
      // Create 25 items
      const testItems = factories.items(testHousehold.id, testUser.id, 25);
      await testDb.insert(items).values(testItems);

      const response = await app.request("/items?page=2&pageSize=10", {
        method: "GET",
        headers: {
          Cookie: authCookie,
        },
      });

      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.data.items).toHaveLength(10);
      expect(json.data.page).toBe(2);
      expect(json.data.total).toBe(25);
    });
  });

  describe("GET /items/:id", () => {
    it("should return specific item", async () => {
      const testItem = factories.item(testHousehold.id, testUser.id);
      await testDb.insert(items).values(testItem);

      const response = await app.request(`/items/${testItem.id}`, {
        method: "GET",
        headers: {
          Cookie: authCookie,
        },
      });

      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe(testItem.id);
      expect(json.data.name).toBe(testItem.name);
    });

    it("should return 404 for non-existent item", async () => {
      const fakeId = "00000000-0000-0000-0000-000000000000";

      const response = await app.request(`/items/${fakeId}`, {
        method: "GET",
        headers: {
          Cookie: authCookie,
        },
      });

      expect(response.status).toBe(404);
    });

    it("should prevent IDOR - cannot access items from other households", async () => {
      // Create another household with an item
      const otherHousehold = factories.household();
      await testDb.insert(households).values(otherHousehold);
      const otherAuthUser = await createAuthUserRow();
      const otherUser = factories.user(otherHousehold.id, { id: otherAuthUser.id });
      const otherItem = factories.item(otherHousehold.id, otherUser.id);

      await testDb.insert(users).values(otherUser);
      await testDb.insert(items).values(otherItem);

      // Try to access other household's item
      const response = await app.request(`/items/${otherItem.id}`, {
        method: "GET",
        headers: {
          Cookie: authCookie,
        },
      });

      expect(response.status).toBe(404); // Should not find item
    });
  });

  describe("PATCH /items/:id", () => {
    it("should update item and return updated data", async () => {
      const testItem = factories.item(testHousehold.id, testUser.id);
      await testDb.insert(items).values(testItem);

      const updates = {
        name: "Updated Name",
        quantity: 5,
        location: "freezer" as const,
      };

      const response = await app.request(`/items/${testItem.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Cookie: authCookie,
        },
        body: JSON.stringify(updates),
      });

      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe(testItem.id);
      expect(json.data.name).toBe("Updated Name");
      expect(json.data.quantity).toBe(5);
      expect(json.data.location).toBe("freezer");

      // Verify database was updated
      const [updatedItem] = await testDb.select().from(items).where(eq(items.id, testItem.id));

      expect(updatedItem.name).toBe("Updated Name");
    });

    it("should return 404 for non-existent item", async () => {
      const fakeId = "00000000-0000-0000-0000-000000000000";

      const response = await app.request(`/items/${fakeId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Cookie: authCookie,
        },
        body: JSON.stringify({ name: "Updated" }),
      });

      expect(response.status).toBe(404);
    });

    it("should prevent IDOR - cannot update items from other households", async () => {
      // Create another household with an item
      const otherHousehold = factories.household();
      await testDb.insert(households).values(otherHousehold);
      const otherAuthUser = await createAuthUserRow();
      const otherUser = factories.user(otherHousehold.id, { id: otherAuthUser.id });
      const otherItem = factories.item(otherHousehold.id, otherUser.id);

      await testDb.insert(users).values(otherUser);
      await testDb.insert(items).values(otherItem);

      const response = await app.request(`/items/${otherItem.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Cookie: authCookie,
        },
        body: JSON.stringify({ name: "Hacked!" }),
      });

      expect(response.status).toBe(404);

      // Verify item was NOT updated
      const [unchangedItem] = await testDb.select().from(items).where(eq(items.id, otherItem.id));

      expect(unchangedItem.name).toBe(otherItem.name);
    });
  });

  describe("DELETE /items/:id", () => {
    it("should delete item and return 200 with the success envelope", async () => {
      // Every route in this API replies with the { success, data, error } envelope
      // (CLAUDE.md "API Design"), including deletes — a real 204 response cannot carry
      // a body at all per HTTP semantics, so items.ts (and every other DELETE handler
      // in this codebase, e.g. shopping-list.ts) intentionally returns 200 with
      // `data: null` rather than 204. The previous 204 expectation here predates that
      // convention and never matched production behavior.
      const testItem = factories.item(testHousehold.id, testUser.id);
      await testDb.insert(items).values(testItem);

      const response = await app.request(`/items/${testItem.id}`, {
        method: "DELETE",
        headers: {
          Cookie: authCookie,
        },
      });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.data).toBeNull();

      // Verify item was deleted
      const [deletedItem] = await testDb.select().from(items).where(eq(items.id, testItem.id));

      expect(deletedItem).toBeUndefined();
    });

    it("should return 404 for non-existent item", async () => {
      const fakeId = "00000000-0000-0000-0000-000000000000";

      const response = await app.request(`/items/${fakeId}`, {
        method: "DELETE",
        headers: {
          Cookie: authCookie,
        },
      });

      expect(response.status).toBe(404);
    });

    it("should prevent IDOR - cannot delete items from other households", async () => {
      // Create another household with an item
      const otherHousehold = factories.household();
      await testDb.insert(households).values(otherHousehold);
      const otherAuthUser = await createAuthUserRow();
      const otherUser = factories.user(otherHousehold.id, { id: otherAuthUser.id });
      const otherItem = factories.item(otherHousehold.id, otherUser.id);

      await testDb.insert(users).values(otherUser);
      await testDb.insert(items).values(otherItem);

      const response = await app.request(`/items/${otherItem.id}`, {
        method: "DELETE",
        headers: {
          Cookie: authCookie,
        },
      });

      expect(response.status).toBe(404);

      // Verify item was NOT deleted
      const [unchangedItem] = await testDb.select().from(items).where(eq(items.id, otherItem.id));

      expect(unchangedItem).toBeDefined();
    });
  });
});
