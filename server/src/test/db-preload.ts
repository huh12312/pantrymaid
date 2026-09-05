import { PostgreSqlContainer } from "@testcontainers/postgresql";

/**
 * Route/integration-test-only global preload (wired via bunfig.toml's `[test] preload`,
 * which runs before ANY test file is imported).
 *
 * server/src/lib/db.ts resolves DATABASE_URL into a module-level singleton exactly
 * once, synchronously, at import time:
 *
 *   const connectionString = process.env.DATABASE_URL;
 *   const client = postgres(connectionString, { ... });
 *
 * Route test files statically import route modules (e.g.
 * `import itemsRoute from "../../routes/items"`), which transitively import
 * middleware/auth -> lib/db and lib/auth. Those static imports are evaluated when the
 * test FILE is loaded — before any beforeAll/setupTestDb() in that file has run. So by
 * the time a per-file setupTestDb() started an ephemeral Postgres testcontainer,
 * lib/db.ts had already captured whatever DATABASE_URL was in the environment at
 * process start (the .env value, pointing at the docker-compose Postgres — which is
 * frequently not running in this workflow) — a completely different database than the
 * one the test fixtures were being inserted into. Every authenticated request would
 * then fail (session lookups, household lookups, everything) against an empty or
 * unreachable database, independent of whether the fixtures were otherwise correct.
 *
 * Starting the shared container and setting DATABASE_URL here — before lib/db.ts (or
 * lib/auth.ts) is ever imported by anything — is what makes the app's db/auth
 * singletons and the test fixtures agree on exactly one database for the whole test
 * run. src/test/setup.ts's setupTestDb() then just opens its own client against that
 * same DATABASE_URL and runs migrations (idempotent — safe to call once per file).
 *
 * The container is intentionally never stopped here: it's shared across every route
 * test file in the process (starting a fresh one per file would re-introduce the same
 * split-database problem the moment a second file imports a route module, since
 * lib/db.ts's singleton is already bound to the first file's container by then).
 * testcontainers' Ryuk reaper cleans it up when the test process exits.
 *
 * Scoped to route/integration test invocations only (the bun invocation's arguments
 * mention "test/routes" or "test/integrations") so `src/test/lib` unit tests don't pay
 * the container startup cost or require Docker.
 */
const runsIntegrationTests = Bun.argv.some(
  (arg) => arg.includes("test/routes") || arg.includes("test/integrations")
);

if (runsIntegrationTests) {
  const container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("pantrymaid_test")
    .withUsername("test")
    .withPassword("test")
    .start();

  process.env.DATABASE_URL = container.getConnectionUri();
}
