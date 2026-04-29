# PantryRadar — Master Build Brief

## What We're Building
A multi-user household inventory app for pantry, fridge, and freezer. Users can add items via barcode scan or receipt photo. Modern feel. Works offline for existing inventory.

---

## Identity
- **App Name:** PantryRadar
- **Bundle ID:** `com.pantrymaid`
- **GitHub Repo:** https://github.com/huh12312/pantryradar (private)

---

## Full Stack

| Layer | Choice |
|---|---|
| **Web** | React + Vite + shadcn/ui + TanStack Query v5 |
| **Mobile** | Expo managed + NativeWind v4 + Expo SQLite |
| **API** | Hono + Bun |
| **Database** | Postgres 16 (Docker container, self-hosted) |
| **ORM** | Drizzle ORM + drizzle-kit migrations |
| **Auth** | Better Auth + Organizations plugin |
| **OCR** | Veryfi API (free tier) |
| **Product DB** | Open Food Facts (free, no API key needed) |
| **LLM** | OpenAI gpt-4.1-nano |
| **Proxy** | Caddy (domain + SSL env-driven) |
| **Monorepo** | Turborepo |
| **Repo** | GitHub private |
| **Testing** | bun test (backend), Vitest + RTL (web), Jest + jest-expo (mobile), Playwright (E2E) |

---

## Monorepo Structure

```
pantrymaid/
├── apps/
│   ├── web/                  # React + Vite
│   └── mobile/               # Expo managed
├── server/                   # Hono + Bun
│   ├── src/
│   │   ├── routes/
│   │   │   ├── items.ts
│   │   │   ├── households.ts
│   │   │   ├── receipt.ts
│   │   │   └── barcode.ts
│   │   ├── lib/
│   │   │   ├── db.ts
│   │   │   ├── auth.ts
│   │   │   ├── openai.ts
│   │   │   ├── veryfi.ts
│   │   │   └── openfoodfacts.ts
│   │   └── index.ts
│   ├── Dockerfile
│   └── bunfig.toml
├── packages/
│   ├── shared/               # Types, Zod schemas, API client, constants
│   └── ui/                   # Shared component primitives (future)
├── Caddyfile
├── docker-compose.yml
├── .env.example
├── turbo.json
└── package.json
```

---

## Docker Compose

```yaml
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    volumes:
      - pgdata:/var/lib/postgresql/data
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-pantrymaid}
      POSTGRES_USER: ${POSTGRES_USER:-pantrymaid}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-pantrymaid}"]
      interval: 10s
      timeout: 5s
      retries: 5

  api:
    build: ./server
    restart: unless-stopped
    env_file: .env
    expose:
      - "3000"
    depends_on:
      postgres:
        condition: service_healthy

  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config
    environment:
      DOMAIN: ${DOMAIN:-localhost}
      SSL_MODE: ${SSL_MODE:-internal}
    depends_on:
      - api

volumes:
  pgdata:
  caddy_data:
  caddy_config:
```

## Caddyfile

```caddyfile
{$DOMAIN} {
    tls {$SSL_MODE}
    reverse_proxy api:3000
}
```

---

## Environment Variables (full list)

```bash
# Database
POSTGRES_DB=pantrymaid
POSTGRES_USER=pantrymaid
POSTGRES_PASSWORD=HkxVZnmezuBpBgRsYZBXKHXLuAXDd8k
DATABASE_URL=postgresql://pantrymaid:HkxVZnmezuBpBgRsYZBXKHXLuAXDd8k@postgres:5432/pantrymaid

# Auth
BETTER_AUTH_SECRET=6cSkra98atYKSz8Mw1Qiw95RR+l8Nyb8CFEH/gEEnoY=
BETTER_AUTH_URL=https://localhost:3000

# OpenAI
OPENAI_API_KEY=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

# Veryfi
VERYFI_CLIENT_ID=vrf6fYjNg0ZE8XtYcoA9MLxPvc5yG2oVImYT5ek
VERYFI_CLIENT_SECRET=7Mplsm27PO3m5JHd0XRRwCIz8wzE7Ou49z51dHGfLeDcTDZFpBkRLjOjj9R8K3HVSIAMpXdSppoWD2iRJbUAWUFpwfAPane3Kc6zzF8h6xdM9CpmibxNpohlfbZY7Gy2
VERYFI_USERNAME=chris225
VERYFI_API_KEY=7Mplsm27PO3m5JHd0XRRwCIz8wzE7Ou49z51dHGfLeDcTDZFpBkRLjOjj9R8K3HVSIAMpXdSppoWD2iRJbUAWUFpwfAPane3Kc6zzF8h6xdM9CpmibxNpohlfbZY7Gy2

# Server
PORT=3000
NODE_ENV=production

# Caddy
DOMAIN=localhost
SSL_MODE=internal
```

---

## Data Model

```sql
households
  id uuid PK
  name text
  invite_code text UNIQUE    -- for joining a household
  created_at timestamptz

users (extends Better Auth users)
  id uuid PK
  household_id uuid FK → households.id
  display_name text
  created_at timestamptz

items
  id uuid PK
  household_id uuid FK → households.id
  name text NOT NULL
  brand text
  category text
  location text CHECK (location IN ('pantry','fridge','freezer'))
  quantity numeric DEFAULT 1
  unit text
  barcode_upc text
  expiration_date date
  expiration_estimated boolean DEFAULT false
  added_by uuid FK → users.id
  added_at timestamptz
  updated_at timestamptz
  notes text

product_cache
  upc text PK
  name text
  brand text
  category text
  image_url text
  source text                -- 'open_food_facts' | 'manual'
  fetched_at timestamptz
```

---

## Auth Design (Better Auth)

- Better Auth with Organizations plugin
- One Organization = one Household
- Invite codes built into Better Auth Organizations (built-in)
- Email + magic link sign-in
- JWT-based sessions
- Household isolation enforced at API route level (not just DB)

---

## LLM Pipeline (gpt-4.1-nano)

```
Receipt photo
  → Veryfi API → line_items[]: { description: "GV MLK HLF GL", qty, price }
  → nano: decode each description + store name context
  → [{ raw: "GV MLK HLF GL", decoded: "Great Value Milk Half Gallon", confidence: 0.92 }]
  → Open Food Facts fuzzy match by decoded name
  → Review screen: user confirms/edits each item
  → Bulk insert to items table

Barcode scan
  → Open Food Facts lookup by UPC
  → If found: pre-fill form, user confirms
  → If not found: manual entry form
  → nano estimates expiration: { days: 7, label: "~1 week", confidence: "high" }

Confidence threshold:
  → nano confidence < 0.7: fallback to gpt-4.1-mini
  → Always require user confirmation on receipt items
```

---

## Offline Strategy

```
Mobile (Expo SQLite):
  - Full items table mirrored locally
  - Reads always from local first
  - Writes: local first → sync_queue table
  - Sync queue flushed on: app foreground, network reconnect
  - Conflict resolution: last-write-wins

Web:
  - TanStack Query cache for offline reads
  - No offline write queue (connectivity assumed)
```

---

## Testing Strategy (TDD — Strict)

**Principle:** Tests written BEFORE implementation. No feature ships without coverage.

| Layer | Framework |
|---|---|
| Backend unit | `bun test` |
| Backend integration | `bun test` + testcontainers (real Postgres) |
| Web unit + component | Vitest + React Testing Library |
| Web API mocking | MSW v2 |
| Mobile component | Jest + jest-expo + RNTL |
| E2E web | Playwright |
| Test data factories | `@faker-js/faker` |

**Coverage minimums:**
- `server/` → 85%
- `packages/shared/` → 90%
- `apps/web/` → 80%
- `apps/mobile/` → 75%

**E2E flows required:**
- Sign up → create household
- Invite link → join household
- Barcode scan → item added
- Receipt photo → review → bulk add
- Offline read → reconnect → sync

---

## Security Requirements

- All secrets via env vars — never hardcoded, never in image layers
- Zod validation on every API route (input sanitization)
- Household isolation enforced at API layer (IDOR prevention)
- Rate limiting on `/auth/*` routes (5 req/min)
- JWT secret rotation support
- Better Auth refresh token rotation enabled
- Docker: API runs as non-root user
- HTTP headers: HSTS, CSP, X-Frame-Options via Hono secure-headers
- CORS locked to known origins in production
- Dependabot enabled on repo
- GitHub Actions: CodeQL SAST on every PR

---

## Agent Build Plan

### Phase 1 — Foundation (run in this order)

**Agent 1 — 🏗️ Scaffold** ← START HERE
- Initialize monorepo with Turborepo
- Root package.json, turbo.json, TypeScript base config
- `packages/shared` — all shared types, Zod schemas, API client (typed fetch wrapper)
- `.env.example` with all vars documented (values as placeholders)
- `.gitignore` (ensure `.env` is ignored, never secrets in repo)
- ESLint + Prettier setup
- Initial commit + push to `https://github.com/huh12312/pantryradar`

**Agent 2 — 🗄️ Database** (after Agent 1)
- Drizzle ORM schema (`server/src/db/schema.ts`)
- drizzle-kit config + migration files
- All tables: households, users, items, product_cache
- Better Auth schema integration (Better Auth manages its own tables)
- Seed script for development data

**Agent 3 — ⚙️ Backend API** (after Agent 1, parallel with Agent 2)
- Hono app with middleware (CORS, auth JWT validation, secure-headers, rate limiting)
- All routes: `/items`, `/households`, `/barcode/:upc`, `/receipt`
- Better Auth integration (Hono middleware)
- Dockerfile (multi-stage, non-root user, x86 target)
- docker-compose.yml + Caddyfile
- `.env.example`
- GitHub Actions: CI on PR + deploy on merge to main

**Agent 7 — 🧪 Testing** (after Agent 1, writes failing tests before implementation)
- Test infrastructure across entire monorepo
- Failing unit tests for all backend routes
- Failing tests for shared package
- Vitest config for web
- Jest + jest-expo config for mobile
- Playwright config + E2E test skeletons for all critical flows
- Test data factories via faker
- Coverage thresholds configured
- CI gates: tests must pass before merge

### Phase 2 — Implementation (parallel, after Phase 1)

**Agent 4 — 📱 Mobile**
- Expo managed app (`com.pantrymaid`)
- NativeWind v4 setup
- Tab navigation: Pantry / Fridge / Freezer / Add
- Barcode scanner screen (expo-camera)
- Receipt capture screen
- Item list + item detail screens
- Expo SQLite offline layer + sync queue
- Auth screens (login / join household / create household)
- Implements against Agent 7's failing tests

**Agent 5 — 🌐 Web**
- React + Vite app
- shadcn/ui + modern theme (clean, minimal, dark mode support)
- Three-location inventory view
- Webcam barcode scan (`@zxing/browser`)
- Receipt upload flow
- Auth pages
- Responsive layout
- Implements against Agent 7's failing tests

**Agent 6 — 🔌 Integrations**
- Veryfi API client + receipt processing endpoint
- Open Food Facts client + product_cache layer
- OpenAI nano client — receipt decode prompt (structured output)
- Expiration estimation prompt (structured output)
- Confidence scoring + mini fallback
- Fuzzy match: decoded name → Open Food Facts
- Rate limiting + retry logic for all external APIs
- Integration tests with mock receipts

### Phase 3 — Security (after Phase 2)

**Agent 8 — 🔒 Security**
- OWASP Top 10 audit
- Auth hardening review
- IDOR test (two households, cross-access attempts)
- Zod validation coverage audit
- Docker hardening verification
- HTTP security headers check
- Dependency vulnerability scan (`bun audit`)
- GitHub secret scanning verification
- CodeQL SAST setup in GitHub Actions
- Document any findings + fixes

---

## Key Decisions Summary

| Decision | Choice | Rationale |
|---|---|---|
| No Supabase Cloud | Self-hosted Postgres | Full control, no vendor limits, all Docker |
| Better Auth | Replaces Supabase Auth | TS-native, Hono-native, Organizations plugin = household built-in |
| Drizzle ORM | Replaces Supabase client | Lightweight, fully typed, works great with Bun |
| Caddy | Replaces nginx | SSL + domain fully env-driven, zero config |
| nano default + mini fallback | Cost efficiency | Household volume = ~$0/month |
| Paper receipt + mandatory review | UX honesty | Abbreviations can't be 100% auto-decoded |
| Expo SQLite offline | Inventory readable offline | Grocery store = bad signal |

---

## What's NOT in Scope (v1)

- Receipt image storage (process and discard)
- Shopping list generation (v2)
- Expiration push notifications (v2)
- Barcode lookup for non-food items
- Nutrition tracking
- Mobile E2E with Detox (deferred to Phase 4)
