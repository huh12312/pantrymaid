# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PantryRadar is a household inventory management app. It is a **Turborepo + pnpm monorepo** with:
- `apps/web` — React + Vite web frontend
- `apps/mobile` — Expo (React Native) mobile app
- `server/` — Hono + Bun API backend
- `packages/shared` — Shared types, Zod schemas, API client, constants
- `packages/ui` — Shared UI components (placeholder)
- `e2e/` — Playwright end-to-end tests (at repo root)

## Common Commands

All commands below are run from the repo root unless noted otherwise.

```bash
# Install all workspace dependencies
pnpm install

# Start all dev servers (web, API)
pnpm dev

# Build all packages and apps
pnpm build

# Lint all packages
pnpm lint

# Format code
pnpm format

# Clean Turborepo cache and node_modules
pnpm clean
```

### Backend (server/)

The server uses **Bun**, not Node. Run these from `server/`:

```bash
bun run dev          # Watch mode with hot reload
bun run build        # Compile TypeScript to dist/
bun run start        # Run compiled output
bun run db:generate  # Generate Drizzle migrations
bun run db:push      # Apply migrations to PostgreSQL
bun run seed         # Populate database with Faker test data
bun test             # Run server tests (Phase 2)
```

### Web App (apps/web/)

```bash
pnpm dev             # Vite dev server on :5173
pnpm build           # Production build
pnpm test            # Vitest (jsdom)
pnpm test Button.test.tsx   # Run a single test file
pnpm test --coverage # Coverage report (80% threshold)
```

### Shared Package (packages/shared/)

```bash
pnpm test            # Vitest (node env, 90% threshold)
```

### E2E Tests (from repo root)

Playwright requires both the API server (`:3000`) and web dev server (`:5173`) to be running; the config auto-starts the web server.

```bash
pnpm test:e2e                              # Run all E2E tests
pnpm exec playwright test e2e/auth.spec.ts # Single spec file
pnpm exec playwright test -g "sign up"     # Filter by test name
pnpm exec playwright test --ui             # Interactive UI mode
pnpm exec playwright show-report           # Open last HTML report
```

### Infrastructure

```bash
docker compose up -d   # Start PostgreSQL + Caddy (required for API)
docker compose down    # Stop services
```

## Architecture

### Request Flow

```
Browser/Mobile → Caddy (reverse proxy) → Hono API (port 3000) → PostgreSQL
```

In development: browser hits Vite dev server on `:5173`, which proxies `/api/*` to the Hono server on `:3000`.

### API Design

All routes return a consistent envelope:
```json
{ "success": true, "data": {}, "error": null }
```

Endpoints:
- `GET /health` — public health check
- `POST|GET /api/auth/**` — Better Auth handler
- `/api/items` — inventory CRUD (auth required)
- `/api/households` — household management (auth required)
- `/api/barcode` — Open Food Facts lookup (auth required)
- `/api/receipt` — Veryfi OCR + OpenAI processing (auth required)

### Auth

Better Auth (`server/src/lib/auth.ts`) handles sessions/JWT. On successful sign-up, the API automatically creates a default household for the user. Auth routes are rate-limited to 5 req/min (in-memory).

### Database

Drizzle ORM + PostgreSQL 16. Schema lives in `server/src/db/schema.ts`:
- `users` (managed by Better Auth)
- `households`, `households_users` (join table with roles)
- `items` (inventory with expiration dates)

Migration files are in `server/drizzle/`. Generate then push: `db:generate` → `db:push`.

### Shared Package Exports

`@pantrymaid/shared` exports from distinct paths:
- `@pantrymaid/shared` — main barrel
- `@pantrymaid/shared/types` — TypeScript interfaces
- `@pantrymaid/shared/schemas` — Zod schemas
- `@pantrymaid/shared/api` — fetch-based API client
- `@pantrymaid/shared/constants` — enums, URLs

### Middleware Stack (server)

Hono middleware applied in order: Logger → Secure Headers → CORS → Rate Limit (auth only) → Zod validation per route.

### Mobile

Expo managed workflow with file-based routing via Expo Router. Uses:
- Expo SQLite for offline inventory caching
- Expo Camera for barcode scanning
- Expo Secure Store for JWT tokens
- NativeWind (Tailwind CSS for React Native)

## Environment Setup

Copy `.env.example` to `.env` and fill in:

```
DATABASE_URL=postgresql://pantrymaid:<password>@localhost:5432/pantrymaid
BETTER_AUTH_SECRET=<openssl rand -base64 32>
BETTER_AUTH_URL=http://localhost:3000
OPENAI_API_KEY=sk-...
VERYFI_CLIENT_ID, VERYFI_CLIENT_SECRET, VERYFI_USERNAME, VERYFI_API_KEY
PORT=3000
NODE_ENV=development
DOMAIN=localhost
SSL_MODE=internal
```

## Code Style

- **TypeScript strict mode** across all packages
- **ESLint** + **Prettier**: `semi: true`, `singleQuote: false`, `tabWidth: 2`, `printWidth: 100`
- Zod validation on all API route inputs — never trust unvalidated input at route boundaries
- Household isolation enforced on every data-access query (IDOR protection)

## CI

GitHub Actions workflows:
- `.github/workflows/ci.yml` — lint + build + unit tests on PRs
- `.github/workflows/e2e.yml` — spins up PostgreSQL, runs migrations, starts API, runs Playwright
- `.github/workflows/deploy.yml` — Docker build (SSH deploy stub)
