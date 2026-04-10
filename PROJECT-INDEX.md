# PantryMaid — Project Index

> Comprehensive codebase reference. See also: `CLAUDE.md` (dev commands), `PANTRYMAID-BRIEF.md` (product brief), `SECURITY-AUDIT.md` (security findings).

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Directory Map](#2-directory-map)
3. [Database Schema](#3-database-schema)
4. [API Reference](#4-api-reference)
5. [Authentication Flow](#5-authentication-flow)
6. [Shared Package](#6-shared-package)
7. [Web App](#7-web-app)
8. [Mobile App](#8-mobile-app)
9. [External Integrations](#9-external-integrations)
10. [Testing](#10-testing)
11. [Infrastructure](#11-infrastructure)
12. [Known Issues & TODOs](#12-known-issues--todos)

---

## 1. Architecture Overview

```
Browser/Mobile
    │
    ▼
Vite dev server :5173  (proxies /api/* → :3000 in dev)
    │               ╲
    │                Caddy (prod, SSL, reverse proxy)
    ▼                       │
Hono API :3000  ◄───────────┘
    │  └── Better Auth  (session/JWT)
    │  └── Drizzle ORM
    ▼
PostgreSQL 16 (Docker)
```

**Tech Stack:**

| Layer | Technology |
|---|---|
| Web | React 18 + Vite + shadcn/ui + TanStack Query v5 |
| Mobile | Expo managed + NativeWind v4 + Expo SQLite |
| API | Hono + Bun |
| Database | PostgreSQL 16 (Docker) |
| ORM | Drizzle ORM + drizzle-kit |
| Auth | Better Auth (session-based, cookie) |
| OCR | Veryfi API |
| Product DB | Open Food Facts (no API key) |
| LLM | OpenAI gpt-4.1-nano (receipt decode + expiration estimate) |
| Proxy | Caddy (env-driven domain + SSL) |
| Monorepo | Turborepo + pnpm workspaces |

**Middleware order (server):** Logger → SecureHeaders → CORS → RateLimit (auth only) → Zod validation per route → authMiddleware per protected route.

**Response envelope (all routes):**
```json
{ "success": true, "data": {}, "error": null }
```

---

## 2. Directory Map

```
pantrymaid/
├── apps/
│   ├── web/                          # React + Vite web app
│   │   ├── src/
│   │   │   ├── App.tsx               # Router + ProtectedRoute wrapper
│   │   │   ├── main.tsx              # React entry, QueryClient setup
│   │   │   ├── components/
│   │   │   │   ├── inventory/
│   │   │   │   │   ├── AddItemDialog.tsx   # Create/edit item form dialog
│   │   │   │   │   ├── BarcodeScanner.tsx  # Webcam barcode scan (@zxing)
│   │   │   │   │   ├── ItemCard.tsx        # Single item display + actions
│   │   │   │   │   ├── ItemList.tsx        # List of ItemCards
│   │   │   │   │   └── ReceiptUpload.tsx   # File upload for receipt OCR
│   │   │   │   ├── layout/
│   │   │   │   │   ├── ThemeProvider.tsx   # System/light/dark theme via context
│   │   │   │   │   └── ThemeToggle.tsx     # Toggle button
│   │   │   │   └── ui/               # shadcn/ui primitives (button, card, dialog…)
│   │   │   ├── lib/
│   │   │   │   ├── api.ts            # fetch wrapper + all API call functions
│   │   │   │   ├── auth.ts           # Zustand auth store (persisted)
│   │   │   │   ├── queryKeys.ts      # TanStack Query key factory
│   │   │   │   └── utils.ts          # cn() helper (clsx + tailwind-merge)
│   │   │   ├── pages/
│   │   │   │   ├── InventoryPage.tsx # Main view: 3-column Pantry/Fridge/Freezer
│   │   │   │   ├── LoginPage.tsx     # Sign in + sign up tabs
│   │   │   │   ├── JoinHouseholdPage.tsx  # Invite code entry
│   │   │   │   ├── AddItemPage.tsx
│   │   │   │   ├── FridgePage.tsx
│   │   │   │   ├── FreezerPage.tsx
│   │   │   │   └── PantryPage.tsx
│   │   │   └── test/
│   │   │       ├── components/       # Vitest + RTL component tests
│   │   │       ├── mocks/            # MSW handlers + server
│   │   │       └── setup.ts
│   │   ├── vite.config.ts            # Proxy /api/* → localhost:3000
│   │   └── vitest.config.ts          # jsdom env, 80% coverage threshold
│   │
│   └── mobile/                       # Expo managed app
│       ├── app/                      # Expo Router file-based routing
│       │   ├── _layout.tsx           # Root layout (auth guard)
│       │   ├── index.tsx             # Redirect to tabs
│       │   ├── login.tsx             # Login screen
│       │   ├── receipt.tsx           # Receipt capture screen
│       │   ├── barcode.tsx           # Barcode scanner screen (expo-camera)
│       │   ├── item/[id].tsx         # Item detail screen
│       │   ├── (tabs)/               # Bottom tab navigator
│       │   │   ├── _layout.tsx       # Tab bar config
│       │   │   ├── pantry.tsx
│       │   │   ├── fridge.tsx
│       │   │   ├── freezer.tsx
│       │   │   └── add.tsx
│       │   └── auth/
│       │       ├── login.tsx
│       │       ├── register.tsx
│       │       └── join.tsx
│       └── src/
│           ├── components/
│           │   └── ItemList.tsx
│           └── lib/
│               ├── api.ts            # Mobile API client
│               ├── auth.ts           # Expo SecureStore token management
│               ├── db.ts             # Expo SQLite schema + queries (offline)
│               └── sync.ts           # Sync queue flush logic
│
├── server/                           # Hono + Bun API
│   ├── src/
│   │   ├── index.ts                  # App entry: middleware, route mount, error handler
│   │   ├── db/
│   │   │   ├── schema.ts             # Drizzle table definitions + relations
│   │   │   └── seed.ts               # Faker-based dev seed
│   │   ├── lib/
│   │   │   ├── auth.ts               # Better Auth instance + createUserHousehold()
│   │   │   ├── db.ts                 # Drizzle client (postgres-js driver)
│   │   │   ├── openai.ts             # gpt-4.1-nano: estimateExpiration(), decodeReceiptItems()
│   │   │   ├── openfoodfacts.ts      # OpenFoodFactsClient: getProductByBarcode(), fuzzySearch()
│   │   │   ├── veryfi.ts             # VeryfiClient: processReceipt() + VeryfiError
│   │   │   └── retry.ts              # withRetry() utility for external API calls
│   │   ├── middleware/
│   │   │   ├── auth.ts               # authMiddleware + getUser() helper
│   │   │   └── ratelimit.ts          # In-memory rate limiter (5 req/min on /api/auth/*)
│   │   └── routes/
│   │       ├── items.ts              # CRUD: POST, GET, GET/:id, PUT/:id, DELETE/:id
│   │       ├── households.ts         # POST /, GET /:id, POST /:id/members
│   │       ├── barcode.ts            # GET /:upc  (Open Food Facts + expiration estimate)
│   │       └── receipt.ts            # POST /  (Veryfi → OpenAI → Open Food Facts)
│   └── drizzle/                      # Generated migration SQL files
│
├── packages/
│   ├── shared/                       # @pantrymaid/shared
│   │   └── src/
│   │       ├── index.ts              # Barrel export
│   │       ├── types/index.ts        # TypeScript interfaces
│   │       ├── schemas/index.ts      # Zod schemas + inferred types
│   │       ├── api/client.ts         # ApiClient class (fetch-based, token-aware)
│   │       └── constants/index.ts    # ITEM_LOCATIONS, EXPIRATION_DEFAULTS, FOOD_CATEGORIES…
│   └── ui/                           # @pantrymaid/ui (placeholder)
│
├── e2e/                              # Playwright tests
│   ├── auth.spec.ts                  # Sign up, sign in, sign out flows
│   ├── inventory.spec.ts             # Add/delete items, location columns
│   ├── barcode.spec.ts               # Barcode scan flow
│   ├── receipt.spec.ts               # Receipt upload flow
│   ├── offline.spec.ts               # Offline read behavior
│   ├── helpers.ts                    # loginAs(), registerAs() helpers
│   └── fixtures.ts                   # TEST_USER, ITEMS test data constants
│
├── .github/workflows/
│   ├── ci.yml                        # Lint + build + unit tests on PRs
│   ├── e2e.yml                       # PostgreSQL + migrations + Playwright
│   └── deploy.yml                    # Docker build + SSH deploy stub
│
├── CLAUDE.md                         # Dev commands + architecture reference
├── PANTRYMAID-BRIEF.md               # Product brief + build plan
├── SECURITY-AUDIT.md                 # Security findings
├── docker-compose.yml                # postgres + api + caddy
├── Caddyfile                         # Reverse proxy config
├── playwright.config.ts              # E2E: baseURL, webServer auto-start
├── turbo.json                        # Turborepo pipeline
└── pnpm-workspace.yaml               # Workspace package paths
```

---

## 3. Database Schema

**File:** `server/src/db/schema.ts`

### Better Auth tables (managed by library)
| Table | Key Columns |
|---|---|
| `user` | `id` (text PK), `email`, `name`, `emailVerified` |
| `session` | `id`, `token`, `userId` → `user.id`, `expiresAt` |
| `account` | `id`, `accountId`, `providerId`, `userId` → `user.id`, `password` |
| `verification` | `id`, `identifier`, `value`, `expiresAt` |

### Application tables
| Table | Key Columns | Notes |
|---|---|---|
| `households` | `id` (uuid PK), `name`, `invite_code` (unique), `created_at` | `invite_code` is 8-char random |
| `users` | `id` (text PK → `user.id`), `household_id` → `households.id`, `display_name` | App profile extending Better Auth user |
| `items` | `id` (uuid PK), `household_id`, `name`, `brand`, `category`, `location` (CHECK: pantry/fridge/freezer), `quantity`, `unit`, `barcode_upc`, `image_url`, `expiration_date`, `expiration_estimated`, `added_by` → `users.id` | Core inventory record |
| `product_cache` | `upc` (text PK), `name`, `brand`, `category`, `image_url`, `source` (open_food_facts/manual), `fetched_at` | 7-day TTL cache for Open Food Facts results |

**Household isolation pattern (IDOR prevention):**
Every query on `items` always includes `AND household_id = user.householdId`.

---

## 4. API Reference

Base URL: `http://localhost:3000` (dev) or your Caddy domain (prod).

All protected routes require a valid Better Auth session cookie.

### Public

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Status check — returns `{ status, timestamp, environment }` |
| `POST` | `/api/auth/sign-up/email` | Register; auto-creates default household on success |
| `POST` | `/api/auth/sign-in/email` | Login |
| `POST` | `/api/auth/sign-out` | Logout |
| `GET` | `/api/auth/**` | All Better Auth handlers (rate-limited: 5/min) |

### Items (auth required)

| Method | Path | Body / Query | Response |
|---|---|---|---|
| `GET` | `/api/items` | `?location=pantry\|fridge\|freezer`, `?page`, `?pageSize` | `PaginatedResponse<Item>` |
| `GET` | `/api/items/:id` | — | `Item` |
| `POST` | `/api/items` | `CreateItemInput` (Zod validated) | `Item` (201) |
| `PUT` | `/api/items/:id` | `UpdateItemInput` (partial, Zod validated) | `Item` |
| `DELETE` | `/api/items/:id` | — | `{ data: null }` |

### Households (auth required)

| Method | Path | Body | Response |
|---|---|---|---|
| `POST` | `/api/households` | `{ name }` | `Household` (201) |
| `GET` | `/api/households/:id` | — | `Household & { members[] }` |
| `POST` | `/api/households/:id/members` | `{ inviteCode: string (8 chars) }` | `Household` |

**Note:** `GET /api/households/me` exists in `ApiClient` but not yet implemented server-side. `POST /api/households/join` (invite-code-only, no household ID) also missing server-side — tracked as a TODO in `apps/web/src/lib/api.ts:108`.

### Barcode (auth required)

| Method | Path | Response |
|---|---|---|
| `GET` | `/api/barcode/:upc` | `BarcodeResult` (upc, name, brand, category, imageUrl, expiration?) |

- Validates UPC is numeric
- Checks `product_cache` first (7-day TTL)
- Falls back to Open Food Facts API
- Appends OpenAI expiration estimate

### Receipt (auth required)

| Method | Path | Body | Response |
|---|---|---|---|
| `POST` | `/api/receipt` | `{ imageBase64: string }` | `{ storeName?, lineItems[], total?, requiresConfirmation: true }` |

**Pipeline:** Veryfi OCR → OpenAI decode → Open Food Facts fuzzy match → return for user confirmation (never auto-inserts).

---

## 5. Authentication Flow

**Library:** Better Auth (`server/src/lib/auth.ts`)

**Session model:** Cookie-based (not Bearer token). Web app uses `credentials: "include"` on all fetch calls. Vite dev server proxies `/api/*` to avoid cross-origin cookie issues.

**Sign-up side effect** (`server/src/index.ts:88`):
After `POST /api/auth/sign-up/email` returns 200, the server reads the response body, extracts `user.id`, and calls `createUserHousehold()` to automatically create a default household and `users` profile row.

**authMiddleware** (`server/src/middleware/auth.ts`):
1. Calls `auth.api.getSession({ headers })` via Better Auth
2. Queries `users` table to get `householdId`
3. Sets `c.set("user", { id, householdId, email })` for downstream handlers
4. Returns 401 if session invalid

**Web auth state** (`apps/web/src/lib/auth.ts`):
Zustand store persisted to `localStorage` under key `auth-storage`. Contains `{ user, isAuthenticated }`. `setAuth()` / `clearAuth()` called from login/logout handlers.

**Rate limiting:** In-memory map in `server/src/middleware/ratelimit.ts`. 5 requests/minute on `/api/auth/*`. Resets per window.

---

## 6. Shared Package

**Package:** `@pantrymaid/shared`

### Import paths
```ts
import { ... } from "@pantrymaid/shared";           // main barrel
import type { Item } from "@pantrymaid/shared/types";
import { createItemSchema } from "@pantrymaid/shared/schemas";
import { ApiClient } from "@pantrymaid/shared/api";
import { FOOD_CATEGORIES } from "@pantrymaid/shared/constants";
```

### Key types (`types/index.ts`)
- `ItemLocation` — `"pantry" | "fridge" | "freezer"`
- `Item` — full inventory record
- `Household` — id, name, inviteCode, createdAt
- `User` — id, householdId, displayName, email, createdAt
- `ProductCache` — upc, name, brand, category, imageUrl, source, fetchedAt
- `ApiResponse<T>` — `{ success, data?, error? }`
- `PaginatedResponse<T>` — `{ items[], total, page, pageSize }`
- `BarcodeResult` — product + optional `ExpirationEstimate`
- `ReceiptItem` — raw + decoded + confidence + optional matchedProduct

### Key schemas (`schemas/index.ts`)
- `createItemSchema` / `updateItemSchema` — Zod, used on server routes
- `itemLocationSchema` — enum validator
- `householdSchema` / `createHouseholdSchema`
- `barcodeProductSchema` / `expirationEstimateSchema`
- `apiResponseSchema<T>` / `paginatedResponseSchema<T>` — generic wrappers

### Constants (`constants/index.ts`)
- `ITEM_LOCATIONS` — `["pantry", "fridge", "freezer"]`
- `EXPIRATION_DEFAULTS` — category → days lookup table (used for OpenAI fallback)
- `FOOD_CATEGORIES` — 13 common food categories
- `COMMON_UNITS` — unit strings (lb, oz, kg, can, box…)
- `API_ENDPOINTS` — path constants
- `STORAGE_KEYS` — localStorage/AsyncStorage key names
- `SYNC_CONFIG` — `{ RETRY_ATTEMPTS: 3, RETRY_DELAY_MS: 1000, BATCH_SIZE: 50 }`

### ApiClient (`api/client.ts`)
Generic fetch wrapper with optional Bearer token injection. Methods: `health()`, `getItems()`, `getItem()`, `createItem()`, `updateItem()`, `deleteItem()`, `getHousehold()`, `createHousehold()`, `joinHousehold()`, `lookupBarcode()`, `processReceipt()`.

---

## 7. Web App

**Entry:** `apps/web/src/main.tsx` → `App.tsx`

**Routing** (React Router v6):
| Path | Component | Protected |
|---|---|---|
| `/login` | `LoginPage` | No |
| `/join` | `JoinHouseholdPage` | No |
| `/inventory` | `InventoryPage` | Yes |
| `/` | Redirect → `/inventory` | — |

**Main view** (`InventoryPage.tsx`):
- Fetches all items via TanStack Query (`queryKeys.inventory.list()`)
- Three-column grid: Pantry / Fridge / Freezer
- Mutations: create, update, delete (all invalidate list query on success)
- Opens `AddItemDialog` (create/edit), `BarcodeScanner`, `ReceiptUpload` as dialogs

**State management:**
- Server state: TanStack Query
- Auth state: Zustand (persisted) — `useAuth()` hook
- UI state: local `useState`

**API layer** (`apps/web/src/lib/api.ts`):
- `API_BASE_URL = ""` — uses relative paths, proxied by Vite
- `credentials: "include"` on all requests (cookie auth)
- Auth: `POST /api/auth/sign-in/email`, `POST /api/auth/sign-up/email`, `POST /api/auth/sign-out`

**Query key factory** (`lib/queryKeys.ts`):
```ts
queryKeys.inventory.list(location?)   // ["inventory", "list", { location }]
queryKeys.inventory.lists()           // ["inventory", "list"]
queryKeys.inventory.detail(id)        // ["inventory", "detail", id]
```

**Vite proxy** (`vite.config.ts`): All `/api/*` and `/health` proxied to `localhost:3000`.

---

## 8. Mobile App

**Framework:** Expo managed workflow, file-based routing via Expo Router.

**Screens** (`apps/mobile/app/`):
- `_layout.tsx` — root layout with auth guard
- `(tabs)/` — bottom tab bar: Pantry, Fridge, Freezer, Add
- `barcode.tsx` — camera barcode scanning (expo-camera)
- `receipt.tsx` — receipt capture
- `item/[id].tsx` — item detail

**Offline layer** (`src/lib/db.ts`):
- Expo SQLite mirrors the `items` table locally
- Reads always from local DB first
- Writes go local → added to `sync_queue`

**Sync** (`src/lib/sync.ts`):
- `sync_queue` flushed on: app foreground, network reconnect
- Conflict resolution: last-write-wins
- Retry config from `SYNC_CONFIG` constants

**Auth** (`src/lib/auth.ts`):
- JWT stored in Expo SecureStore
- `STORAGE_KEYS.AUTH_TOKEN` key

---

## 9. External Integrations

### Open Food Facts (`server/src/lib/openfoodfacts.ts`)
- Free, no API key
- `getProductByBarcode(upc)` — exact lookup + `product_cache` layer (7-day TTL)
- `fuzzySearch(name)` — returns `FuzzyMatch[]` sorted by confidence
- Used by both `/api/barcode` and `/api/receipt`

### Veryfi (`server/src/lib/veryfi.ts`)
- OCR for receipt images
- `VeryfiClient.processReceipt(imageBase64)` → `VeryfiResponse` (vendor, line_items, total)
- `VeryfiError` class with `statusCode` for specific error handling (429 rate limit, 400 bad image)
- Env: `VERYFI_CLIENT_ID`, `VERYFI_CLIENT_SECRET`, `VERYFI_USERNAME`, `VERYFI_API_KEY`

### OpenAI (`server/src/lib/openai.ts`)
- Model: `gpt-4.1-nano` (default), falls back to `gpt-4.1-mini` if confidence < 0.7
- `estimateExpiration(productName, category?)` → `ExpirationEstimate { days, label, confidence }`
- `decodeReceiptItems(lineItems, storeName?)` → `DecodedItem[]` — expands abbreviated receipt text
- Env: `OPENAI_API_KEY`

### Retry utility (`server/src/lib/retry.ts`)
- `withRetry(fn, attempts, delayMs)` — wraps any async call
- Used internally by external API clients

---

## 10. Testing

### Coverage targets
| Package | Threshold |
|---|---|
| `server/` | 85% |
| `packages/shared/` | 90% |
| `apps/web/` | 80% |
| `apps/mobile/` | 75% |

### Test locations
| Layer | Framework | Location |
|---|---|---|
| Server routes | `bun test` | `server/src/test/routes/*.test.ts` |
| Server integrations | `bun test` (mocked) | `server/src/test/integrations/*.test.ts` |
| Server factories | Faker | `server/src/test/factories.ts` |
| Shared schemas | Vitest | `packages/shared/src/test/schemas.test.ts` |
| Web components | Vitest + RTL | `apps/web/src/test/components/*.test.tsx` |
| Web API mocking | MSW v2 | `apps/web/src/test/mocks/` |
| Mobile components | Jest + jest-expo | `apps/mobile/src/test/components/` |
| E2E | Playwright | `e2e/*.spec.ts` |

### E2E specs
- `auth.spec.ts` — sign up, sign in (valid + invalid), sign out
- `inventory.spec.ts` — 3-column view, add to pantry, add with expiry, delete item
- `barcode.spec.ts` — barcode scan flow
- `receipt.spec.ts` — receipt upload + review flow
- `offline.spec.ts` — offline read behavior

**E2E helpers** (`e2e/helpers.ts`): `loginAs(page, user)`, `registerAs(page, user)`
**E2E fixtures** (`e2e/fixtures.ts`): `TEST_USER`, `ITEMS` (pantry, withExpiry objects)

### CI
- `ci.yml` — runs on PR: lint → build → unit tests
- `e2e.yml` — spins up PostgreSQL service, runs migrations, starts API + web, runs Playwright
- `deploy.yml` — Docker build + SSH deploy (stub)

---

## 11. Infrastructure

### Docker Compose (`docker-compose.yml`)
| Service | Image | Port |
|---|---|---|
| `postgres` | postgres:16-alpine | internal |
| `api` | ./server (Dockerfile) | expose 3000 |
| `caddy` | caddy:2-alpine | 80, 443 |

`caddy` depends on `api`; `api` depends on `postgres` (healthcheck).

### Caddy (`Caddyfile`)
```
{$DOMAIN} {
    tls {$SSL_MODE}
    reverse_proxy api:3000
}
```
`DOMAIN=localhost`, `SSL_MODE=internal` for local dev.

### Environment variables (key ones)
```
DATABASE_URL          postgresql://...
BETTER_AUTH_SECRET    openssl rand -base64 32
BETTER_AUTH_URL       http://localhost:3000
OPENAI_API_KEY        sk-...
VERYFI_CLIENT_ID/SECRET/USERNAME/API_KEY
PORT=3000
NODE_ENV=development
DOMAIN=localhost
SSL_MODE=internal
```

---

## 12. Known Issues & TODOs

### Server-side gaps
- `GET /api/households/me` — referenced in `ApiClient` but not implemented in server routes
- `POST /api/households/join` — web `api.ts:108` calls `/api/households/join` (no household ID), but server requires `POST /api/households/:id/members` with ID in URL. No route handles invite-code-only joining.
- `GET /api/items` count query uses `countResult.count` but selects `itemsTable.id` — actual count is the number of distinct ID rows, which is a workaround (not a SQL `COUNT(*)`)

### Web app
- `uploadReceipt` in `apps/web/src/lib/api.ts:162` sends `multipart/form-data` with `receipt` field, but the server `POST /api/receipt` expects `application/json` with `{ imageBase64 }` — mismatch
- Receipt upload result is not shown to the user (mutation success just invalidates queries)
- Barcode lookup result sets `editItem` with empty `id`/`householdId` — these need to be stripped before submitting

### Mobile
- SQLite sync conflict resolution is last-write-wins with no timestamp comparison guard

### CI / E2E
- E2E `auth.spec.ts` uses `POST /api/auth/register` (non-existent) to pre-create users; actual Better Auth endpoint is `POST /api/auth/sign-up/email`
- Playwright `playwright.config.ts` only runs Chromium; no cross-browser coverage

### Security
- CORS `allowedOrigins` returns `allowedOrigins[0]` (`:5173`) for unlisted origins instead of rejecting — effectively permissive fallback
- Rate limiter is in-memory and resets on server restart (no Redis persistence)
