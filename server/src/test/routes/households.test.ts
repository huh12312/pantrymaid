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

  describe("GET /households/me", () => {
    it("should return the authenticated user's household with members", async () => {
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

      const response = await app.request("/households/me", {
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

    it("should return 404, not 403, when the user has no household", async () => {
      // beforeEach's authenticated session has no household of its own. GET /me never
      // takes a client-supplied household id — it only ever looks up the caller's own
      // householdId — so there is no "wrong household" to be forbidden from; a user
      // with no household is simply told 404, never 403, which matches the codebase's
      // deliberate choice not to confirm that some other household exists.
      const response = await app.request("/households/me", {
        method: "GET",
        headers: {
          Cookie: authCookie,
        },
      });

      expect(response.status).toBe(404);
      const json = await response.json();
      expect(json.success).toBe(false);
    });

    it("should prevent IDOR - only ever returns the caller's own household, never another's", async () => {
      // Create two households. user1 (household1) reuses beforeEach's authenticated
      // session; user2 is a completely separate member of household2. Since /me has no
      // id parameter to attack, isolation here means: user1's response must reflect
      // household1 only, with no trace of household2's data.
      const household1 = factories.household();
      const household2 = factories.household();
      await testDb.insert(households).values([household1, household2]);

      const user1 = factories.user(household1.id, { id: testUserId });
      const authUser2 = await createAuthUserRow();
      const user2 = factories.user(household2.id, {
        id: authUser2.id,
        displayName: "Should Not Leak",
      });
      await testDb.insert(users).values([user1, user2]);

      const response = await app.request("/households/me", {
        method: "GET",
        headers: {
          Cookie: authCookie,
        },
      });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.data.id).toBe(household1.id);
      expect(json.data.id).not.toBe(household2.id);
      expect(json.data.members).toHaveLength(1);
      expect(json.data.members.map((m: { displayName: string }) => m.displayName)).not.toContain(
        "Should Not Leak"
      );
    });

    it("should not expose another household's invite code to a non-member", async () => {
      const testHousehold = factories.household({ inviteCode: "SECRETCD" });
      await testDb.insert(households).values(testHousehold);

      const memberAuthUser = await createAuthUserRow();
      const member = factories.user(testHousehold.id, { id: memberAuthUser.id });
      await testDb.insert(users).values(member);

      // beforeEach's authenticated session belongs to no household — it plays the
      // outsider trying to reach someone else's household data via /me. Since /me is
      // always scoped to the caller's own (nonexistent) householdId, this 404s before
      // ever touching `testHousehold`'s row.
      const response = await app.request("/households/me", {
        method: "GET",
        headers: {
          Cookie: authCookie,
        },
      });

      expect(response.status).toBe(404);
      const body = await response.text();
      expect(body).not.toContain("SECRETCD");
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

    it("prevents IDOR - does not mutate another household's settings", async () => {
      // household1 is the caller's own household; household2 belongs to nobody the
      // caller is associated with. A PATCH scoped to "my household" must never touch
      // household2's row, regardless of how many other households exist in the table.
      const household1 = factories.household();
      const household2 = {
        ...factories.household(),
        krogerLocationId: "OTHERLOC",
        krogerStoreName: "Other Store",
        krogerChain: "OTHR",
        krogerZipCode: "00000",
      };
      const user1 = factories.user(household1.id, { id: testUserId });
      await testDb.insert(households).values([household1, household2]);
      await testDb.insert(users).values(user1);

      const response = await app.request("/households/me/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: authCookie },
        body: JSON.stringify({
          krogerLocationId: "MYLOC",
          krogerStoreName: "My Store",
          krogerChain: "MINE",
          krogerZipCode: "11111",
        }),
      });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.data.id).toBe(household1.id);

      const [untouched] = await testDb
        .select()
        .from(households)
        .where(eq(households.id, household2.id));
      expect(untouched.krogerLocationId).toBe("OTHERLOC");
      expect(untouched.krogerStoreName).toBe("Other Store");
      expect(untouched.krogerChain).toBe("OTHR");
      expect(untouched.krogerZipCode).toBe("00000");
    });
  });

  describe("POST /households/join", () => {
    it("should join a household via a valid invite code", async () => {
      // Create household
      const testHousehold = factories.household({
        inviteCode: "TESTCODE",
      });
      await testDb.insert(households).values(testHousehold);

      // beforeEach's authenticated session has no household yet — perfect "new user
      // trying to join" actor.
      const newUserId = testUserId;

      const response = await app.request("/households/join", {
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
      expect(json.data.id).toBe(testHousehold.id);

      // Verify user was added to household
      const [addedUser] = await testDb.select().from(users).where(eq(users.id, newUserId));

      expect(addedUser).toBeDefined();
      expect(addedUser.householdId).toBe(testHousehold.id);
    });

    it("should fail with an invalid invite code", async () => {
      const testHousehold = factories.household({
        inviteCode: "TESTCODE",
      });
      await testDb.insert(households).values(testHousehold);

      const response = await app.request("/households/join", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: authCookie,
        },
        body: JSON.stringify({
          inviteCode: "WRONGCOD",
        }),
      });

      expect(response.status).toBe(400);

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

      const response = await app.request("/households/join", {
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

      const response = await app.request("/households/join", {
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
