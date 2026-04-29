# PantryRadar

A multi-user household inventory app for pantry, fridge, and freezer management. Track food items by barcode scan or receipt photo, monitor expiration dates, and share a household with family members via invite code.

## Tech Stack

| Layer | Technology |
|---|---|
| Web | React 19 + Vite 8 + shadcn/ui + TanStack Query v5 |
| Mobile | Expo SDK 55 (managed) + NativeWind v4 + Expo SQLite |
| API | Hono + Bun |
| Database | PostgreSQL 16 (Docker) + Drizzle ORM |
| Auth | Better Auth (email/password, session cookies) |
| Proxy | Caddy (automatic SSL in production) |
| Monorepo | Turborepo + pnpm |

### External integrations

| Service | Purpose |
|---|---|
| Open Food Facts | Barcode → product name, brand, category, image |
| Veryfi | Receipt OCR (line items + totals) |
| OpenAI / Anthropic / Groq / Ollama | Receipt decoding, expiration estimation, image normalisation |
| Wikipedia PageImages API | Free-licensed food images |
| Pexels | Stock photo fallback for item images |

LLM provider is configurable via `LLM_PROVIDER` env var (`openai` \| `anthropic` \| `groq` \| `ollama`). Defaults to OpenAI `gpt-4o-mini`.

---

## Project Structure

```
pantryradar/
├── apps/
│   ├── web/                  # React + Vite web app  (port 5173)
│   └── mobile/               # Expo React Native app (port 8081)
├── server/                   # Hono + Bun API        (port 3000)
├── packages/
│   ├── shared/               # Zod schemas, types, API client, constants
│   └── ui/                   # Shared UI components (placeholder)
├── e2e/                      # Playwright end-to-end tests
├── docker-compose.yml        # PostgreSQL + Caddy
├── Caddyfile
└── .env.example
```

---

## Getting Started

### Prerequisites

- **Bun** 1.x
- **pnpm** 9+
- **Docker** + Docker Compose
- Node.js 20+ (for web/shared packages)

### Setup

```bash
# 1. Clone
git clone https://github.com/huh12312/pantryradar.git
cd pantryradar

# 2. Install dependencies
pnpm install

# 3. Configure environment
cp .env.example .env
# Fill in DATABASE_URL, BETTER_AUTH_SECRET, OPENAI_API_KEY, Veryfi creds, etc.

# 4. Start PostgreSQL
docker compose up -d postgres

# 5. Apply database schema
cd server && bun run db:push && cd ..

# 6. Start dev servers (web + API)
pnpm dev
```

Web app: **http://localhost:5173**  
API: **http://localhost:3000**

---

## Common Commands

Run from the repo root unless noted.

```bash
pnpm dev          # Start web + API + mobile dev servers
pnpm build        # Build all packages and apps
pnpm lint         # ESLint across all packages
pnpm format       # Prettier
pnpm clean        # Clear Turborepo cache and node_modules
```

### Backend (`server/`)

```bash
bun run dev          # Watch mode
bun run db:generate  # Generate Drizzle migration files
bun run db:push      # Apply schema to PostgreSQL
bun run seed         # Seed database with Faker test data
bun test             # Run server unit + integration tests
```

### Web app (`apps/web/`)

```bash
pnpm dev             # Vite dev server on :5173
pnpm test            # Vitest (jsdom)
pnpm test --coverage # Coverage report (80% threshold)
```

### E2E tests (repo root)

Requires API (`:3000`) and web dev server (`:5173`) to be running.

```bash
pnpm test:e2e
pnpm exec playwright test --ui    # Interactive mode
pnpm exec playwright show-report
```

---

## Architecture

```
Browser / Mobile
       │
       ▼
Vite dev :5173  (proxies /api/* → :3000)
       │
       ▼
Hono API :3000
  ├── Better Auth      — session cookies, email/password
  ├── Drizzle ORM      — PostgreSQL 16
  ├── Image Resolver   — Wikipedia → Pexels fallback (fire-and-forget)
  └── LLM layer        — multi-provider via Vercel AI SDK
```

**API response envelope:**
```json
{ "success": true, "data": {}, "error": null }
```

**Key routes:**

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | — | Health check |
| POST/GET | `/api/auth/**` | — | Better Auth handler |
| GET/POST/PUT/DELETE | `/api/items` | ✓ | Inventory CRUD |
| GET/POST | `/api/households` | ✓ | Household management |
| POST | `/api/households/join` | ✓ | Join via invite code |
| GET | `/api/barcode/:upc` | ✓ | Open Food Facts lookup |
| POST | `/api/receipt` | ✓ | Veryfi OCR + LLM decoding |

---

## Household & Invite Codes

On sign-up a household is automatically created for the user. The 8-character invite code is displayed in the sidebar and can be copied to the clipboard. A second user enters the code at `/join` to join the same household.

Codes use a 32-character unambiguous alphabet (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`) generated with `crypto.getRandomValues` (~35 bits of entropy).

---

## Environment Variables

See `.env.example` for the full list. Key variables:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `BETTER_AUTH_SECRET` | 32-byte random secret (`openssl rand -base64 32`) |
| `BETTER_AUTH_URL` | API base URL (e.g. `http://localhost:3000`) |
| `OPENAI_API_KEY` | OpenAI key (required unless using another LLM provider) |
| `LLM_PROVIDER` | `openai` \| `anthropic` \| `groq` \| `ollama` (default: `openai`) |
| `LLM_MODEL` | Model override (defaults per provider) |
| `VERYFI_CLIENT_ID` | Veryfi credentials for receipt OCR |
| `PEXELS_API_KEY` | Optional — enables Pexels fallback images |
| `DOMAIN` | Production domain |
| `SSL_MODE` | `internal` (dev) or `auto` (production Let's Encrypt) |

---

## Deployment

GitHub Actions workflows:

- **`.github/workflows/ci.yml`** — lint + build + unit tests on every PR
- **`.github/workflows/e2e.yml`** — spins up PostgreSQL, runs migrations, runs Playwright
- **`.github/workflows/deploy.yml`** — Docker build + SSH deploy (configure `SSH_PRIVATE_KEY`, `SSH_HOST`, `SSH_USER` secrets)

For production, only PostgreSQL + Caddy need Docker. The API can run directly with `bun run start` after `bun run build`.

---

## License

Private — all rights reserved.
