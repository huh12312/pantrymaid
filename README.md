# PantryRadar

A multi-user household inventory app for pantry, fridge, and freezer management. Track your food items, scan barcodes, process receipts, and never let food expire again.

## Tech Stack

### Frontend
- **Web**: React + Vite + shadcn/ui + TanStack Query v5
- **Mobile**: Expo (managed workflow) + NativeWind v4 + Expo SQLite

### Backend
- **API**: Hono + Bun
- **Database**: PostgreSQL 16 (self-hosted in Docker)
- **ORM**: Drizzle ORM
- **Auth**: Better Auth with Organizations plugin
- **Proxy**: Caddy (automatic SSL)

### Integrations
- **OCR**: Veryfi API (receipt processing)
- **Product DB**: Open Food Facts (barcode lookup)
- **LLM**: OpenAI gpt-4.1-nano (receipt decoding, expiration estimation)

### Monorepo
- **Build System**: Turborepo
- **Package Manager**: pnpm
- **Testing**:
  - Backend: bun test
  - Web: Vitest + React Testing Library
  - Mobile: Jest + jest-expo
  - E2E: Playwright

## Project Structure

```
pantrymaid/
├── apps/
│   ├── web/                  # React + Vite web app
│   └── mobile/               # Expo mobile app
├── server/                   # Hono + Bun API server
├── packages/
│   ├── shared/               # Shared types, schemas, API client, constants
│   └── ui/                   # Shared UI components (future)
├── docker-compose.yml
├── Caddyfile
└── .env.example
```

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm 8+
- Bun 1.0+
- Docker & Docker Compose

### Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/huh12312/pantryradar.git
   cd pantrymaid
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   ```

3. **Configure environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your actual credentials
   ```

   **Important**: Never commit `.env` or any files containing real secrets!

4. **Start the development environment**
   ```bash
   # Start all services (PostgreSQL, API, Caddy)
   docker compose up -d
   ```

5. **Run the web app**
   ```bash
   cd apps/web
   pnpm dev
   # Open http://localhost:5173
   ```

6. **Run the mobile app**
   ```bash
   cd apps/mobile
   pnpm dev
   # Scan QR code with Expo Go app
   ```

## Development

### Available Scripts

From the root directory:

```bash
pnpm dev          # Start all apps in development mode
pnpm build        # Build all packages and apps
pnpm test         # Run all tests
pnpm lint         # Lint all packages
pnpm format       # Format code with Prettier
```

### Database Migrations

```bash
cd server
bun run drizzle-kit generate:pg
bun run drizzle-kit migrate
```

### Docker Commands

```bash
# Start all services
docker compose up -d

# View logs
docker compose logs -f

# Stop all services
docker compose down

# Rebuild API container
docker compose up -d --build api
```

## Testing

```bash
# Run all tests
pnpm test

# Run tests for specific package
cd packages/shared && pnpm test
cd server && bun test
cd apps/web && pnpm test
cd apps/mobile && pnpm test
```

## Deployment

The project includes GitHub Actions workflows for CI/CD:

- **CI**: Runs on every PR - lints, builds, and tests all packages
- **Deploy**: Runs on push to main - builds Docker image and deploys (SSH details to be configured)

### Production Deployment

1. Set up a production server with Docker and Docker Compose
2. Configure GitHub secrets:
   - `SSH_PRIVATE_KEY`
   - `SSH_HOST`
   - `SSH_USER`
3. Update `.github/workflows/deploy.yml` with deployment steps
4. Push to main branch to trigger deployment

## Environment Variables

See `.env.example` for all required environment variables. Key variables:

- `DATABASE_URL`: PostgreSQL connection string
- `BETTER_AUTH_SECRET`: Random 32-byte secret for JWT signing
- `OPENAI_API_KEY`: OpenAI API key for LLM features
- `VERYFI_*`: Veryfi credentials for receipt OCR
- `DOMAIN`: Your domain name for production
- `SSL_MODE`: `internal` for development, `auto` for production with Let's Encrypt

## Security

- All secrets must be stored in `.env` and never committed to Git
- `.gitignore` includes `.env`, `*.secrets.*`, and other sensitive patterns
- API runs as non-root user in Docker
- Better Auth handles JWT refresh token rotation
- Zod validation on all API routes
- CORS locked to known origins in production

## License

Private repository - All rights reserved

## Agent Build Progress

- [x] Phase 1: Foundation - Agent 1 (Scaffold) ✅
- [ ] Phase 1: Foundation - Agent 2 (Database)
- [ ] Phase 1: Foundation - Agent 3 (Backend API)
- [ ] Phase 1: Foundation - Agent 7 (Testing)
- [ ] Phase 2: Implementation - Agent 4 (Mobile)
- [ ] Phase 2: Implementation - Agent 5 (Web)
- [ ] Phase 2: Implementation - Agent 6 (Integrations)
- [ ] Phase 3: Security - Agent 8 (Security Audit)
