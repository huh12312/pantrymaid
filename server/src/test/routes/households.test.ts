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
import { households, users } from "../../db/schema";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import householdsRoute from "../../routes/households";

describe("Households API Routes", () => {
  let app: Hono;
  let authCookie: string;
  let testUserId: string;

  beforeAll(async () => {
    await setupTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await clearTables();

    // Real Better Auth session for authenticated requests. This user intentionally has
    // no `users` (app) row yet — several tests below exercise "brand new user with no
    // household" flows (e.g. POST /households).
    const session = await createTestSession();
    testUserId = session.id;
    authCookie = session.cookie;

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
          Cookie: authCookie,
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
        .where(eq(households.id, json.data.id));

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
          Cookie: authCookie,
        },
        body: JSON.stringify(newHousehold),
      });

      const json = await response.json();
      const householdId = json.data.id;

      // Verify user was created and linked to household
      const [createdUser] = await testDb
        .select()
        .from(users)
        .where(eq(users.householdId, householdId));

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
          Cookie: authCookie,
        },
        body: JSON.stringify(invalidHousehold),
      });

      expect(response.status).toBe(400);
    });

    it("should generate unique invite codes", async () => {
      // POST /households 400s a second time for the same user ("User already belongs
      // to a household" — see routes/households.ts), so two distinct households need
      // two distinct authenticated users, not two calls from the same session.
      const household1 = { name: "Household 1" };
      const household2 = { name: "Household 2" };
      const otherSession = await createTestSession();

      const response1 = await app.request("/households", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: authCookie,
        },
        body: JSON.stringify(household1),
      });

      const response2 = await app.request("/households", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: otherSession.cookie,
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
      // Create household and users. user1 reuses beforeEach's authenticated session so
      // the request below is made as an actual member of the household.
      const testHousehold = factories.household();
      await testDb.insert(households).values(testHousehold);

      const user1 = factories.user(testHousehold.id, {
        id: testUserId,
        displayName: "John Doe",
      });
      const authUser2 = await createAuthUserRow();
      const user2 = factories.user(testHousehold.id, {
        id: authUser2.id,
        displayName: "Jane Doe",
      });

      await testDb.insert(users).values([user1, user2]);

      const response = await app.request(`/households/${testHousehold.id}`, {
        method: "GET",
        headers: {
          Cookie: authCookie,
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
          Cookie: authCookie,
        },
      });

      expect(response.status).toBe(404);
    });

    it("should prevent IDOR - cannot access other households", async () => {
      // Create two households. user1 (household1) reuses beforeEach's authenticated
      // session and tries to access household2.
      const household1 = factories.household();
      const household2 = factories.household();
      await testDb.insert(households).values([household1, household2]);

      const user1 = factories.user(household1.id, { id: testUserId });
      const authUser2 = await createAuthUserRow();
      const user2 = factories.user(household2.id, { id: authUser2.id });
      await testDb.insert(users).values([user1, user2]);

      const response = await app.request(`/households/${household2.id}`, {
        method: "GET",
        headers: {
          Cookie: authCookie,
        },
      });

      expect(response.status).toBe(403); // Forbidden
    });

    it("should not expose invite code to non-members", async () => {
      const testHousehold = factories.household();
      await testDb.insert(households).values(testHousehold);

      const householdAuthUser = await createAuthUserRow();
      const householdUser = factories.user(testHousehold.id, { id: householdAuthUser.id });
      await testDb.insert(users).values(householdUser);

      // beforeEach's authenticated session has no household of its own — it plays the
      // "other user" trying to access someone else's household.
      const response = await app.request(`/households/${testHousehold.id}`, {
        method: "GET",
        headers: {
          Cookie: authCookie,
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

  describe("PATCH /households/me/settings", () => {
    it("saves Kroger store settings to the household", async () => {
      const testHousehold = factories.household();
      const user = factories.user(testHousehold.id, { id: testUserId });
      await testDb.insert(households).values(testHousehold);
      await testDb.insert(users).values(user);

      const response = await app.request("/households/me/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: authCookie },
        body: JSON.stringify({
          krogerLocationId: "09700165",
          krogerStoreName: "Harris Teeter - Shops at Shadowline",
          krogerChain: "HART",
          krogerZipCode: "28607",
        }),
      });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.data.krogerLocationId).toBe("09700165");
      expect(json.data.krogerStoreName).toBe("Harris Teeter - Shops at Shadowline");
      expect(json.data.krogerChain).toBe("HART");
      expect(json.data.krogerZipCode).toBe("28607");
    });

    it("clears store settings when null values are passed", async () => {
      const testHousehold = {
        ...factories.household(),
        krogerLocationId: "09700165",
        krogerStoreName: "Harris Teeter - Shops at Shadowline",
        krogerChain: "HART",
        krogerZipCode: "28607",
      };
      const user = factories.user(testHousehold.id, { id: testUserId });
      await testDb.insert(households).values(testHousehold);
      await testDb.insert(users).values(user);

      const response = await app.request("/households/me/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: authCookie },
        body: JSON.stringify({
          krogerLocationId: null,
          krogerStoreName: null,
          krogerChain: null,
          krogerZipCode: null,
        }),
      });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.data.krogerLocationId).toBeNull();
    });

    it("requires authentication", async () => {
      const response = await app.request("/households/me/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ krogerLocationId: "09700165" }),
      });
      expect(response.status).toBe(401);
    });

    it("returns 404 when user has no household", async () => {
      // User with no household
      const response = await app.request("/households/me/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: authCookie },
        body: JSON.stringify({ krogerLocationId: "09700165" }),
      });
      expect(response.status).toBe(404);
    });
  });

  describe("POST /households/:id/members", () => {
    it("should add member via invite code", async () => {
      // Create household
      const testHousehold = factories.household({
        inviteCode: "TESTCODE",
      });
      await testDb.insert(households).values(testHousehold);

      // beforeEach's authenticated session has no household yet — perfect "new user
      // trying to join" actor.
      const newUserId = testUserId;

      const response = await app.request(`/households/${testHousehold.id}/members`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: authCookie,
        },
        body: JSON.stringify({
          inviteCode: "TESTCODE",
        }),
      });

      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.data.householdId).toBe(testHousehold.id);

      // Verify user was added to household
      const [addedUser] = await testDb.select().from(users).where(eq(users.id, newUserId));

      expect(addedUser).toBeDefined();
      expect(addedUser.householdId).toBe(testHousehold.id);
    });

    it("should fail with invalid invite code", async () => {
      const testHousehold = factories.household({
        inviteCode: "TESTCODE",
      });
      await testDb.insert(households).values(testHousehold);

      const response = await app.request(`/households/${testHousehold.id}/members`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: authCookie,
        },
        body: JSON.stringify({
          inviteCode: "WRONGCODE",
        }),
      });

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
      // existingUser reuses beforeEach's authenticated session, which then tries to
      // join household2 despite already belonging to household1.
      const existingUser = factories.user(household1.id, { id: testUserId });

      await testDb.insert(households).values([household1, household2]);
      await testDb.insert(users).values(existingUser);

      const response = await app.request(`/households/${household2.id}/members`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: authCookie,
        },
        body: JSON.stringify({
          inviteCode: "NEWHOUSE",
        }),
      });

      expect(response.status).toBe(400);

      const json = await response.json();
      expect(json.error).toMatch(/already.*household/i);
    });

    it("should fail without authentication", async () => {
      const testHousehold = factories.household();
      await testDb.insert(households).values(testHousehold);

      const response = await app.request(`/households/${testHousehold.id}/members`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inviteCode: testHousehold.inviteCode,
        }),
      });

      expect(response.status).toBe(401);
    });
  });
});
