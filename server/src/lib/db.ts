import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "../db/schema";

/**
 * Lazily-initialised Postgres client and Drizzle instance.
 *
 * This module used to read `DATABASE_URL` and `throw` at module scope, which made it
 * impossible to *import* anything that transitively reached it without a database
 * configured. That is a real problem for pure unit tests: `lib/openai.ts` now reads
 * household LLM settings, so importing it pulled in this module and blew up in CI
 * (which has no `.env`) even for tests that never touch Postgres.
 *
 * Connection details are therefore resolved on FIRST USE rather than at import. The
 * error message is unchanged, so a genuinely misconfigured server still fails loudly —
 * just at the first query instead of at import. This also removes the import-order
 * hazard the test harness had to work around: `DATABASE_URL` can now be set by a test
 * preload after this module is imported and still be picked up.
 */

let cachedClient: Sql | undefined;
let cachedDb: PostgresJsDatabase<typeof schema> | undefined;

function resolveClient(): Sql {
  if (cachedClient) return cachedClient;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not set");
  }

  cachedClient = postgres(connectionString, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    // SSL disabled by default — enable via DB_SSL=true for hosted databases
    ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: true } : false,
  });
  return cachedClient;
}

function resolveDb(): PostgresJsDatabase<typeof schema> {
  if (!cachedDb) cachedDb = drizzle(resolveClient(), { schema });
  return cachedDb;
}

/** Forwards property access to the real target, binding methods so `this` stays correct. */
function forward<T extends object>(resolve: () => T) {
  return (prop: string | symbol): unknown => {
    const target = resolve() as unknown as Record<string | symbol, unknown>;
    const value = target[prop];
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(target)
      : value;
  };
}

// `client` is postgres.js's tagged-template function AND an object with methods
// (`.end()`, `.unsafe()`), so the proxy needs a callable target plus an `apply` trap.
const forwardClient = forward(resolveClient);
export const client = new Proxy(function clientProxy() {} as unknown as Sql, {
  apply(_target, thisArg, args) {
    const real = resolveClient() as unknown as (...a: unknown[]) => unknown;
    return Reflect.apply(real, thisArg, args);
  },
  get(_target, prop) {
    return forwardClient(prop);
  },
});

const forwardDb = forward(resolveDb);
export const db = new Proxy({} as PostgresJsDatabase<typeof schema>, {
  get(_target, prop) {
    return forwardDb(prop);
  },
});
