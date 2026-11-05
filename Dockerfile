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

# --- Stage 2: Build Backend ---
FROM node:20-slim AS backend-builder
WORKDIR /app
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY .npmrc ./
COPY package*.json ./
COPY packages/backend/package*.json ./packages/backend/
# Install with exact versions (prisma pinned to 5.x in package.json)
RUN npm install --workspace=packages/backend --legacy-peer-deps
COPY packages/backend ./packages/backend
# Use LOCAL binary — avoids npx downloading latest Prisma (v7) from npm
RUN /app/node_modules/.bin/prisma generate --schema /app/packages/backend/prisma/schema.prisma
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
# Install production deps (prisma pinned to 5.22.0 — no v7 drift)
RUN npm install --workspace=packages/backend --legacy-peer-deps

# Copy Prisma schema & scripts
COPY packages/backend/prisma ./packages/backend/prisma
COPY packages/backend/scripts ./packages/backend/scripts

# Copy compiled artifacts from builders
COPY --from=backend-builder /app/packages/backend/dist ./packages/backend/dist
COPY --from=frontend-builder /app/packages/frontend/dist ./packages/frontend/dist

# Generate Prisma Client using the pinned LOCAL binary (not npx)
RUN /app/node_modules/.bin/prisma generate --schema /app/packages/backend/prisma/schema.prisma

EXPOSE 3001

# Use local prisma binary at startup for db push too
CMD ["sh", "-c", "/app/node_modules/.bin/prisma db push --schema /app/packages/backend/prisma/schema.prisma && node /app/packages/backend/dist/index.js"]
