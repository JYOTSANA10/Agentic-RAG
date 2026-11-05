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
# prisma is now a production dependency — binary is fully installed, generate works cleanly
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

# prisma is now in dependencies (not devDependencies) so it installs in production
# npm install in NODE_ENV=production installs ALL dependencies
RUN npm install --workspace=packages/backend --legacy-peer-deps

# Generate prisma client inside this container using its own installed binary
RUN /app/node_modules/.bin/prisma generate --schema /app/packages/backend/prisma/schema.prisma || true

# Copy schema, scripts, compiled code, and built frontend
COPY packages/backend/prisma ./packages/backend/prisma
COPY packages/backend/scripts ./packages/backend/scripts
COPY --from=backend-builder /app/packages/backend/dist ./packages/backend/dist
COPY --from=frontend-builder /app/packages/frontend/dist ./packages/frontend/dist

EXPOSE 3001

# On every boot:
#   1. Push DB schema (creates/migrates SQLite — safe to run repeatedly)
#   2. Auto-create admin from ADMIN_EMAIL / ADMIN_PASSWORD env vars
#   3. Start the app
CMD ["sh", "-c", "\
  /app/node_modules/.bin/prisma db push --schema /app/packages/backend/prisma/schema.prisma && \
  node /app/packages/backend/scripts/create-admin.mjs && \
  node /app/packages/backend/dist/index.js \
"]
