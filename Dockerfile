# ==============================================================================
# Enterprise IT Support Copilot - Production Multi-stage Dockerfile
# ==============================================================================

# --- Stage 1: Build Frontend ---
FROM node:20-slim AS frontend-builder
WORKDIR /app
COPY .npmrc ./
COPY package*.json ./
COPY packages/frontend/package*.json ./packages/frontend/
RUN npm install --workspace=packages/frontend --legacy-peer-deps
COPY packages/frontend ./packages/frontend
RUN npm run build --workspace=packages/frontend

# --- Stage 2: Build Backend (includes ALL deps: prod + dev) ---
FROM node:20-slim AS backend-builder
WORKDIR /app
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY .npmrc ./
COPY package*.json ./
COPY packages/backend/package*.json ./packages/backend/
RUN npm install --workspace=packages/backend --legacy-peer-deps
COPY packages/backend ./packages/backend
# Generate Prisma client using local pinned binary (5.22.0)
RUN /app/node_modules/.bin/prisma generate --schema /app/packages/backend/prisma/schema.prisma
# Compile TypeScript
RUN npm run build --workspace=packages/backend

# --- Stage 3: Production Runner ---
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001

RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY .npmrc ./
COPY package*.json ./
COPY packages/backend/package*.json ./packages/backend/

# Install production deps (prisma CLI is devDep, skipped here — copied from builder below)
RUN npm install --workspace=packages/backend --legacy-peer-deps

# Copy Prisma schema and scripts
COPY packages/backend/prisma ./packages/backend/prisma
COPY packages/backend/scripts ./packages/backend/scripts

# Copy compiled artifacts
COPY --from=backend-builder /app/packages/backend/dist ./packages/backend/dist
COPY --from=frontend-builder /app/packages/frontend/dist ./packages/frontend/dist

# Copy the ENTIRE @prisma scope from builder (includes @prisma/engines, @prisma/client,
# @prisma/internals etc.) + the prisma CLI package + its .bin entry
COPY --from=backend-builder /app/node_modules/.prisma   ./node_modules/.prisma
COPY --from=backend-builder /app/node_modules/@prisma   ./node_modules/@prisma
COPY --from=backend-builder /app/node_modules/prisma    ./node_modules/prisma
COPY --from=backend-builder /app/node_modules/.bin/prisma ./node_modules/.bin/prisma

EXPOSE 3001

# Run prisma db push to initialise/migrate the SQLite DB, then start the app
CMD ["sh", "-c", "/app/node_modules/.bin/prisma db push --schema /app/packages/backend/prisma/schema.prisma && node /app/packages/backend/dist/index.js"]
