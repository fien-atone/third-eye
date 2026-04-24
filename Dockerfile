# --- Stage 1: build client ---
FROM node:20-slim AS client-build
WORKDIR /build/client
COPY client/package.json client/package-lock.json* ./
RUN npm ci
COPY client/ ./
RUN npm run build

# --- Stage 2: install server deps (incl. native better-sqlite3 build) ---
FROM node:20-slim AS server-deps
WORKDIR /build/server
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY server/package.json server/package-lock.json* ./
RUN npm ci --omit=dev

# --- Stage 3: runtime ---
FROM node:20-slim AS runtime
WORKDIR /app/server

COPY server/package.json server/tsconfig.json ./
COPY server/*.ts ./
COPY server/lib ./lib
COPY --from=server-deps /build/server/node_modules ./node_modules
COPY --from=client-build /build/client/dist ../client/dist

ENV NODE_ENV=production
ENV PORT=4317
ENV THIRD_EYE_DB=/app/server/data/third-eye.db
ENV CLAUDE_CONFIG_DIR=/data/claude
ENV CODEX_HOME=/data/codex

EXPOSE 4317
CMD ["npx", "tsx", "index.ts"]
