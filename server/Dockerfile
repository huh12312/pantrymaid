# Multi-stage build for Bun + Hono with pnpm monorepo
FROM oven/bun:1-alpine AS builder

# Install pnpm
RUN apk add --no-cache nodejs npm && npm install -g pnpm@8

# Set working directory
WORKDIR /app

# Copy root package files and workspace config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY .npmrc ./

# Copy all workspace packages
COPY packages/shared/package.json ./packages/shared/
COPY packages/ui/package.json ./packages/ui/
COPY server/package.json ./server/

# Install dependencies with frozen lockfile
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/shared ./packages/shared
COPY server ./server

# Build the server
WORKDIR /app/server
RUN bun run build

# Production stage
FROM oven/bun:1-alpine

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

WORKDIR /app

# Copy built application and dependencies
COPY --from=builder --chown=nodejs:nodejs /app/server/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/server/package.json ./package.json
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/packages/shared ./packages/shared

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD bun run -e 'fetch("http://localhost:3000/health").then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))'

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["bun", "run", "dist/index.js"]
