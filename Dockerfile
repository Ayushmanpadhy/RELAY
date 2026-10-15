# Stage 1: Build all workspaces
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package manifests for workspace caching
COPY package.json package-lock.json* ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/

# Install dependencies including build tools
RUN npm ci

# Copy full repository source
COPY . .

# Build shared types, server, and web frontend
RUN npm run build

# Stage 2: Minimal production runtime
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000
ENV HOST=0.0.0.0
ENV DATA_DIR=/data

# Copy package manifests for production install
COPY package.json package-lock.json* ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/

RUN npm ci --omit=dev

# Copy compiled artifacts from builder
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/apps/web/dist ./apps/web/dist

# Create persistent data directory
RUN mkdir -p /data

VOLUME ["/data"]

EXPOSE 4000

CMD ["node", "apps/server/dist/index.js"]
