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
RUN cd packages/backend && npx prisma generate
RUN npm run build --workspace=packages/backend

# --- Stage 3: Production Runner ---
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
ENV NODE_PATH=/app/node_modules

RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY .npmrc ./
COPY package*.json ./
COPY packages/backend/package*.json ./packages/backend/
RUN npm install --workspace=packages/backend --legacy-peer-deps

# Copy Prisma schema, scripts, and compiled code
COPY packages/backend/prisma ./packages/backend/prisma
COPY packages/backend/scripts ./packages/backend/scripts
COPY --from=backend-builder /app/packages/backend/dist ./packages/backend/dist
COPY --from=frontend-builder /app/packages/frontend/dist ./packages/frontend/dist

# Generate Prisma Client directly inside runner
RUN cd packages/backend && npx prisma generate

EXPOSE 3001

CMD ["sh", "-c", "cd packages/backend && npx prisma db push && node dist/index.js"]
