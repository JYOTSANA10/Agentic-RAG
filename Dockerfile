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
RUN npm install --workspace=packages/backend --legacy-peer-deps
COPY packages/backend ./packages/backend
# Use LOCAL pinned prisma binary (5.22.0) — avoids npx pulling latest v7
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

# Install production dependencies only (NODE_ENV=production skips devDeps by default)
RUN npm install --workspace=packages/backend --legacy-peer-deps

# Copy Prisma schema & helper scripts
COPY packages/backend/prisma ./packages/backend/prisma
COPY packages/backend/scripts ./packages/backend/scripts

# Copy compiled backend & built frontend from builder stages
COPY --from=backend-builder /app/packages/backend/dist ./packages/backend/dist
COPY --from=frontend-builder /app/packages/frontend/dist ./packages/frontend/dist

# Copy the already-generated Prisma client + CLI binary from backend-builder
# (prisma CLI is a devDep — not installed in production runner — reuse builder output)
COPY --from=backend-builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=backend-builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=backend-builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=backend-builder /app/node_modules/.bin/prisma ./node_modules/.bin/prisma

EXPOSE 3001

# Run prisma db push (creates SQLite file) then start the app
CMD ["sh", "-c", "/app/node_modules/.bin/prisma db push --schema /app/packages/backend/prisma/schema.prisma && node /app/packages/backend/dist/index.js"]
