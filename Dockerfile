# Project uses npm workspaces — the authoritative lockfile lives at
# the repo root, NOT in client/ or server/ subdirs. Each stage installs
# from root with `-w <workspace>` so resolved deps stay in sync with
# what local dev installs (otherwise stale per-package lockfiles cause
# `npm ci` to fail when deps land in package.json before the lockfiles
# get re-synced — issue #2).

# --- Stage 1: build client ---
FROM node:20-slim AS client-build
WORKDIR /build
# Copy manifests + lockfile first so dep changes don't bust cache for
# unrelated source edits.
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci -w client --include-workspace-root=false
COPY client ./client
RUN npm run -w client build

# --- Stage 2: install server deps (incl. native better-sqlite3 build) ---
FROM node:20-slim AS server-deps
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci -w server --omit=dev --include-workspace-root=false

# --- Stage 3: runtime ---
FROM node:20-slim AS runtime
WORKDIR /app
# npm hoists shared deps to /build/node_modules in the workspace root.
# Node module resolution walks up from /app/server/* to /app/node_modules,
# so we keep that layout: deps at /app, source at /app/server.
COPY --from=server-deps /build/node_modules ./node_modules
COPY --from=server-deps /build/package.json ./
COPY server/package.json server/tsconfig.json ./server/
COPY server/*.ts ./server/
COPY server/lib ./server/lib
COPY --from=client-build /build/client/dist ./client/dist

WORKDIR /app/server

ENV NODE_ENV=production
ENV PORT=4317
ENV THIRD_EYE_DB=/app/server/data/third-eye.db
ENV CLAUDE_CONFIG_DIR=/data/claude
ENV CODEX_HOME=/data/codex

EXPOSE 4317
CMD ["npx", "tsx", "index.ts"]
