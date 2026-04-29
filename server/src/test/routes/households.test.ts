 
 
 
 
 
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { setupTestDb, teardownTestDb, clearTables, testDb } from "../setup";
import { factories } from "../factories";
import { households, users } from "../../db/schema";
import { Hono } from "hono";
import householdsRoute from "../../routes/households";

describe("Households API Routes", () => {
  let app: Hono;
  let authToken: string;
  let testUserId: string;

  beforeAll(async () => {
    await setupTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await clearTables();

    // Mock user ID for authenticated requests
    testUserId = factories.user("temp-id").id;
    authToken = `Bearer mock-token-${testUserId}`;

    // Setup app with routes
    app = new Hono();
    app.route("/households", householdsRoute);
  });

  describe("POST /households", () => {
    it("should create a new household and return 201", async () => {
      const newHousehold = {
        name: "Smith Family",
      };

      const response = await app.request("/households", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authToken,
        },
        body: JSON.stringify(newHousehold),
      });

      expect(response.status).toBe(201);

      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.data.name).toBe("Smith Family");
      expect(json.data.id).toBeDefined();
      expect(json.data.inviteCode).toBeDefined();
      expect(json.data.inviteCode).toHaveLength(8); // Standard invite code length
      expect(json.data.createdAt).toBeDefined();

      // Verify household was inserted into database
      const [insertedHousehold] = await testDb
        .select()
        .from(households)
        .where((t) => t.id === json.data.id);

      expect(insertedHousehold).toBeDefined();
      expect(insertedHousehold.name).toBe("Smith Family");
      expect(insertedHousehold.inviteCode).toBeDefined();
    });

    it("should create user record and associate with household", async () => {
      const newHousehold = {
        name: "Test Household",
      };

      const response = await app.request("/households", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authToken,
        },
        body: JSON.stringify(newHousehold),
      });

      const json = await response.json();
      const householdId = json.data.id;

      // Verify user was created and linked to household
      const [createdUser] = await testDb
        .select()
        .from(users)
        .where((t) => t.householdId === householdId);

      expect(createdUser).toBeDefined();
      expect(createdUser.id).toBe(testUserId);
      expect(createdUser.householdId).toBe(householdId);
    });

    it("should fail without authentication", async () => {
      const newHousehold = {
        name: "Test Household",
      };

      const response = await app.request("/households", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(newHousehold),
      });

      expect(response.status).toBe(401);
    });

    it("should fail with invalid data (empty name)", async () => {
      const invalidHousehold = {
        name: "",
      };

      const response = await app.request("/households", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authToken,
        },
        body: JSON.stringify(invalidHousehold),
      });

      expect(response.status).toBe(400);
    });

    it("should generate unique invite codes", async () => {
      const household1 = { name: "Household 1" };
      const household2 = { name: "Household 2" };

      const response1 = await app.request("/households", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authToken,
        },
        body: JSON.stringify(household1),
      });

      const response2 = await app.request("/households", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authToken,
        },
        body: JSON.stringify(household2),
      });

      const json1 = await response1.json();
      const json2 = await response2.json();

      expect(json1.data.inviteCode).not.toBe(json2.data.inviteCode);
    });
  });

  describe("GET /households/:id", () => {
    it("should return household with members", async () => {
      // Create household and users
      const testHousehold = factories.household();
      const user1 = factories.user(testHousehold.id, {
        displayName: "John Doe",
      });
      const user2 = factories.user(testHousehold.id, {
        displayName: "Jane Doe",
      });

      await testDb.insert(households).values(testHousehold);
      await testDb.insert(users).values([user1, user2]);

      // Update auth to be one of the users
      authToken = `Bearer mock-token-${user1.id}`;

      const response = await app.request(`/households/${testHousehold.id}`, {
        method: "GET",
        headers: {
          Authorization: authToken,
        },
      });

      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe(testHousehold.id);
      expect(json.data.name).toBe(testHousehold.name);
      expect(json.data.members).toHaveLength(2);
      expect(json.data.members[0].displayName).toBeDefined();
      expect(json.data.members[1].displayName).toBeDefined();
    });

    it("should return 404 for non-existent household", async () => {
      const fakeId = "00000000-0000-0000-0000-000000000000";

      const response = await app.request(`/households/${fakeId}`, {
        method: "GET",
        headers: {
          Authorization: authToken,
        },
      });

      expect(response.status).toBe(404);
    });

    it("should prevent IDOR - cannot access other households", async () => {
      // Create two households
      const household1 = factories.household();
      const household2 = factories.household();
      const user1 = factories.user(household1.id);
      const user2 = factories.user(household2.id);

      await testDb.insert(households).values([household1, household2]);
      await testDb.insert(users).values([user1, user2]);

      // User from household1 tries to access household2
      authToken = `Bearer mock-token-${user1.id}`;

      const response = await app.request(`/households/${household2.id}`, {
        method: "GET",
        headers: {
          Authorization: authToken,
        },
      });

      expect(response.status).toBe(403); // Forbidden
    });

    it("should not expose invite code to non-members", async () => {
      const testHousehold = factories.household();
      const householdUser = factories.user(testHousehold.id);
      const otherUser = factories.user("other-household-id");

      await testDb.insert(households).values(testHousehold);
      await testDb.insert(users).values(householdUser);

      // Other user tries to access household
      authToken = `Bearer mock-token-${otherUser.id}`;

      const response = await app.request(`/households/${testHousehold.id}`, {
        method: "GET",
        headers: {
          Authorization: authToken,
        },
      });

      const json = await response.json();

      // Should either be forbidden or not include invite code
      if (response.status === 200) {
        expect(json.data.inviteCode).toBeUndefined();
      } else {
        expect(response.status).toBe(403);
      }
    });
  });

  describe("POST /households/:id/members", () => {
    it("should add member via invite code", async () => {
      // Create household
      const testHousehold = factories.household({
        inviteCode: "TESTCODE",
      });
      await testDb.insert(households).values(testHousehold);

      // New user trying to join
      const newUserId = factories.user("temp").id;
      authToken = `Bearer mock-token-${newUserId}`;

      const response = await app.request(
        `/households/${testHousehold.id}/members`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: authToken,
          },
          body: JSON.stringify({
            inviteCode: "TESTCODE",
          }),
        }
      );

      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.data.householdId).toBe(testHousehold.id);

      // Verify user was added to household
      const [addedUser] = await testDb
        .select()
        .from(users)
        .where((t) => t.id === newUserId);

      expect(addedUser).toBeDefined();
      expect(addedUser.householdId).toBe(testHousehold.id);
    });

    it("should fail with invalid invite code", async () => {
      const testHousehold = factories.household({
        inviteCode: "TESTCODE",
      });
      await testDb.insert(households).values(testHousehold);

      const response = await app.request(
        `/households/${testHousehold.id}/members`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: authToken,
          },
          body: JSON.stringify({
            inviteCode: "WRONGCODE",
          }),
        }
      );

      expect(response.status).toBe(403);

      const json = await response.json();
      expect(json.success).toBe(false);
      expect(json.error).toMatch(/invalid.*invite.*code/i);
    });

    it("should fail if user already belongs to a household", async () => {
      // Create two households
      const household1 = factories.household();
      const household2 = factories.household({
        inviteCode: "NEWHOUSE",
      });
      const existingUser = factories.user(household1.id);

      await testDb.insert(households).values([household1, household2]);
      await testDb.insert(users).values(existingUser);

      // User from household1 tries to join household2
      authToken = `Bearer mock-token-${existingUser.id}`;

      const response = await app.request(
        `/households/${household2.id}/members`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: authToken,
          },
          body: JSON.stringify({
            inviteCode: "NEWHOUSE",
          }),
        }
      );

      expect(response.status).toBe(400);

      const json = await response.json();
      expect(json.error).toMatch(/already.*household/i);
    });

    it("should fail without authentication", async () => {
      const testHousehold = factories.household();
      await testDb.insert(households).values(testHousehold);

      const response = await app.request(
        `/households/${testHousehold.id}/members`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            inviteCode: testHousehold.inviteCode,
          }),
        }
      );

      expect(response.status).toBe(401);
    });
  });
});
