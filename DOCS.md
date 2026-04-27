# Third Eye — Technical documentation

This is the deep-dive companion to the README. Architecture, API reference,
operations, platform specifics.

## Tech stack

- **Runtime**: Node.js 20+ — single language end-to-end
- **Backend**: Express · TypeScript · `tsx` (no build step) · `better-sqlite3` (synchronous, file-based)
- **Storage**: SQLite with WAL mode · single file · shareable as-is
- **Frontend**: React 19 · TypeScript · Vite · TanStack Query (server state, optimistic UI)
- **Charts**: Recharts (declarative SVG, industry-standard)
- **Dates**: date-fns v4 with 5 locales (`en-US`, `ru`, `zh-CN`, `es`, `de`)
- **Styling**: plain CSS with theme tokens · dark / light / system
- **i18n**: zero-dependency typed dictionaries · `<html lang>` + persistent locale
- **Container**: multi-stage Dockerfile · `docker compose` orchestration

**Deliberate non-choices**: no ORM (SQL is prepared statements, schema is
tiny), no CSS framework, no state-management library (React Query covers
server state, component state for the rest), no routing library (hash-based
router in ~30 lines fits the app).

---

## Install options in detail

### Docker (primary)

```bash
git clone https://github.com/fien-atone/third-eye
cd third-eye
docker compose up -d --build
```

The compose file:

- Mounts `~/.claude` and `~/.codex` read-only into the container via
  `${USER_HOME:-${HOME:-${USERPROFILE}}}` — picks the right home on any shell
- Persists SQLite to `./server/data/` on the host
- Runs incremental ingest every 15 minutes (`THIRD_EYE_INGEST_INTERVAL_MIN`,
  window `THIRD_EYE_INGEST_SINCE=2h`)
- Health check via `/api/health`
- Binds the in-container server to `0.0.0.0` (only what you list under `ports:`
  gets exposed on the host)

Manual container ingest:

```bash
docker compose exec third-eye npm run ingest:hour
docker compose exec third-eye npm run ingest:full
```

Plain `docker run`:

```bash
docker build -t third-eye .

docker run -d --name third-eye -p 4317:4317 \
  -v "$HOME/.claude:/data/claude:ro" \
  -v "$HOME/.codex:/data/codex:ro" \
  -v "$PWD/server/data:/app/server/data" \
  -e THIRD_EYE_INGEST_INTERVAL_MIN=15 \
  -e THIRD_EYE_HOST=0.0.0.0 \
  third-eye
```

### Node native

Uses npm workspaces at the repo root to orchestrate client + server.

```bash
git clone https://github.com/fien-atone/third-eye
cd third-eye
npm install           # pulls deps for both server and client
npm start             # builds client, starts server on :4317 (static UI served by server)
```

Run as a service via your tool of choice (`pm2`, `systemd`, `launchd`,
Windows Service) pointing at `server/index.ts` with `tsx`.

### Dev mode (contributors)

Two processes with HMR.

```bash
npm run dev
```

Starts server on `:4317` and Vite on `:5173` in parallel (via `concurrently`).
Open http://localhost:5173. Vite proxies `/api/*` to the server.

---

## Ingest

### Scripts

All idempotent (upsert by dedup key, safe to re-run):

```bash
npm run ingest            # full rescan (default)
npm run ingest:hour       # last 1h
npm run ingest:day        # last 24h
npm run ingest:week       # last 7d

# custom window:
npm --prefix server run ingest -- --since=30m
npm --prefix server run ingest -- --since=3d
```

Via HTTP (the **Refresh** button calls this):

```bash
curl -X POST http://localhost:4317/api/refresh                # full
curl -X POST 'http://localhost:4317/api/refresh?since=1h'     # incremental
```

### Scheduler (one command, cross-platform)

```bash
npm run schedule:install      # register hourly ingest
npm run schedule:status       # verify + recent log tail
npm run schedule:uninstall    # remove
```

| Platform | Mechanism | Location |
|---|---|---|
| macOS   | `launchd` user agent | `~/Library/LaunchAgents/org.thirdeye.ingest.plist` |
| Linux   | `cron` user crontab  | `crontab -l`, tagged `# org.thirdeye.ingest` |
| Windows | `schtasks` user task | Task Scheduler → `ThirdEyeIngest` |

Runs `npm run ingest:hour` every hour. Absolute npm path resolved at install
time, so nvm / fnm / Homebrew keep working. Log: `~/.third-eye-ingest.log`.
Idempotent — safe to re-run.

Inside Docker, use `THIRD_EYE_INGEST_INTERVAL_MIN` instead (default 15 min).

### Destructive rebuild

`ingest:rebuild` wipes `api_calls`, `projects`, and meta, then re-ingests from
scratch. Use when:

- Classifier / pricing logic changed and you want every row recomputed
- Stale projects (deleted from disk) should disappear
- Dedup state is suspected corrupted

```bash
npm run ingest:rebuild                               # interactive, type "rebuild"
npm --prefix server run ingest:rebuild -- --yes      # cron/CI
```

Safeguards:

- Interactive prompt requires typing the word `rebuild` (anything else cancels)
- Non-interactive shells refuse without `--yes` (protects against `| tee`)
- Regenerates project UUIDs → existing `#/project/<uuid>` bookmarks break

---

## API

| Endpoint | Description |
|---|---|
| `GET /api/providers` | Provider list with totals and `lastIngestAt` |
| `GET /api/projects`  | Project list with `id` (UUID), `key`, `label`, totals |
| `GET /api/overview?granularity=day\|week\|month&start=YYYY-MM-DD&end=YYYY-MM-DD&providers=all\|claude,codex&projectId=<uuid>&tzOffsetMin=<min>&weekStartsOn=<0-6>` | Time series + breakdowns |
| `GET /api/insights/:projectId?start=&end=&tzOffsetMin=&providers=` | Per-project insights (subagents, skills, MCP, bash, files, versions, branches, heatmap) |
| `POST /api/refresh[?since=<dur>\|?full=1]` | Trigger ingest, returns stats |
| `GET /api/health` | Health check (used by Docker healthcheck) |

---

## Cost calculation

Per API call:

```
cost = input_tokens   * input_rate
     + output_tokens  * output_rate
     + cache_write    * cache_write_rate
     + cache_read     * cache_read_rate
     + web_search     * web_search_rate
```

Multiplied by `fastMultiplier` when `usage.speed === 'fast'` (Opus 4.6 = 6×).
Pricing is fetched from LiteLLM's public catalogue, cached 24h locally, with a
hardcoded fallback table if the network is unavailable.

**Averages** divide by *active* periods, not the full calendar window — a $78
spend across 2 active days out of 30 is reported as $39/day, not $2.61/day.

**Deduplication** is by `message.id` for Claude Code and by a synthetic key for
Codex — both unique primary keys in `api_calls`, so re-ingest is always safe.

---

## Timezone handling

Storage is timezone-agnostic (UTC ISO + Unix epoch ms). Display is
client-local: the browser sends `tzOffsetMin` with every query, the server
shifts timestamps in SQL (`datetime(ts, '+180 minutes')` for Moscow, etc.)
before bucketing. Same `.db` file viewed in Moscow vs New York shows each
user's local-day breakdown.

Week start is also locale-aware: `en-US` / `zh-CN` start weeks on **Sunday**,
`ru` / `de` / `es` on **Monday`. Client sends `weekStartsOn`; server uses it
in `strftime` to align weekly buckets.

---

## Sharing your data

SQLite is a single file: `server/data/codeburn.db`.

1. Copy it to the target machine.
2. Run Third Eye there without mounting `~/.claude` / `~/.codex` — the data is
   in the DB already. In Docker, remove those volume lines.
3. Disable auto-ingest (`THIRD_EYE_INGEST_INTERVAL_MIN=0`) so it doesn't try to
   scan non-existent session folders.

**Privacy note**: for Cowork ephemeral projects, labels are the first user
message of each task. If you share the `.db`, the recipient sees those. If
sensitive, share the code and let them build their own DB.

---

## Windows specifics

Session paths auto-detect — Claude Code / Desktop / Codex are all found under
`%USERPROFILE%` / `%APPDATA%` without config.

If `npm install` fails on `better-sqlite3` with a node-gyp error, install
**Visual Studio Build Tools** with the "Desktop development with C++"
workload and retry. One-time Windows prerequisite for any native Node module.

`docker-compose.yml` uses `${USER_HOME:-${HOME:-${USERPROFILE}}}` chain —
picks the right home on any shell. If none are set, create a `.env` next to
`docker-compose.yml`:

```
USER_HOME=C:\Users\your-name
```

For the Node-native path, the scheduler uses `schtasks.exe /Create /SC HOURLY`
and resolves the absolute `npm` path via `where npm` at install time.

---

## Upgrading

See [UPGRADING.md](./UPGRADING.md) for the safe upgrade procedure. Short
version: back up `server/data/codeburn.db`, then pull and restart.
Schema migrations apply automatically on startup; data is preserved.

---

## Project layout

```
webapp/
├── package.json             Workspace root (scripts: start, dev, ingest:*, schedule:*)
├── Dockerfile               Multi-stage build (client + server)
├── docker-compose.yml
├── README.md                Marketing / motivation / quickstart
├── DOCS.md                  You are here
├── LICENSE                  MIT
├── THIRD_PARTY_NOTICES.md   CodeBurn + LiteLLM attribution
│
├── client/                  Vite + React UI
│   ├── src/
│   │   ├── App.tsx          Main dashboard component
│   │   ├── Logo.tsx         Three concentric rings logo
│   │   ├── router.ts        Hash-based router (home / project / notfound)
│   │   ├── theme.ts         Light/Dark/System persistence
│   │   └── i18n/
│   │       ├── index.tsx    Provider, useT hook, LOCALES registry
│   │       ├── dateLocale.ts  Maps UI locale → date-fns Locale
│   │       ├── en.ts · ru.ts · zh.ts · es.ts · de.ts
│   │   └── index.css        Theme tokens + component styles
│   ├── public/favicon.svg
│   └── vite.config.ts
│
└── server/
    ├── index.ts             Express HTTP server, SQL aggregation
    ├── ingest.ts            CLI + library entry for ingestion
    ├── schedule.ts          Cross-platform scheduler (launchd / cron / schtasks)
    ├── db.ts                better-sqlite3 wrapper, schema, migrations
    ├── lib/                 Vendored session parser (see THIRD_PARTY_NOTICES.md)
    │   ├── parser.ts
    │   ├── models.ts
    │   ├── classifier.ts
    │   ├── bash-utils.ts
    │   ├── types.ts
    │   └── providers/
    │       ├── claude.ts    Claude Code + Desktop/Cowork session discovery
    │       ├── codex.ts     Codex JSONL parser, tool name normalization
    │       └── index.ts
    └── data/                SQLite DB file (gitignored)
```

---

## Release checklist (maintainers)

Before tagging `vX.Y.Z` and pushing the tag, verify **both** install
paths work end-to-end on the commit you're about to release. Each
release where Docker breaks for new users (issue #2 was one) is a
release where the maintainer ran only `npm run dev` and assumed
parity. Don't assume.

```bash
# 1. Type-check both workspaces (catches silent regressions)
cd server && npx tsc --noEmit && cd ..
cd client && npx tsc --noEmit -p tsconfig.app.json && cd ..

# 2. Production frontend build (catches Vite / dep issues)
npm run build

# 3. Ingest pipeline works against the source tree
npm run ingest

# 4. ⭐ Docker — easy to skip, easy to break, never skip again.
docker build -t third-eye:rc .
docker run -d --name third-eye-rc -p 4318:4317 \
  -v "$HOME/.claude:/data/claude:ro" \
  -e THIRD_EYE_HOST=0.0.0.0 \
  third-eye:rc
sleep 8
curl -fsS http://127.0.0.1:4318/api/health || echo "❌ Docker health failed"
docker logs third-eye-rc | tail -20    # sanity-glance for ingest errors
docker stop third-eye-rc && docker rm third-eye-rc
```

If any step fails, fix before tagging. Docker specifically catches
two classes of bugs the Node-native path masks:

- **Stale per-package `package-lock.json`** (the project uses
  workspaces, only the root lockfile matters; if Dockerfile pins
  per-package locks, drift is silent until `npm ci` errors out).
- **Native deps that need build tools** (`better-sqlite3` won't
  compile without `python3 / make / g++`; locally those tools are
  ambient, in the Alpine/slim base image they aren't).

After the four steps pass, bump version in **all three**
`package.json` files (root + client + server), update `CHANGELOG.md`
under a new `## [X.Y.Z] — YYYY-MM-DD` heading, commit, tag, push tag.
The `release.yml` workflow auto-publishes the GitHub Release using
the matching CHANGELOG section as the body.

---

## Credits

This project would not exist without
**[CodeBurn](https://github.com/AgentSeal/codeburn)** by
[AgentSeal](https://agentseal.org) — MIT-licensed CLI for AI coding spend
tracking. Files in `server/lib/` (parser, classifier, models, provider
adapters) are vendored from CodeBurn with attribution headers.

Pricing data fetched at runtime from
[LiteLLM](https://github.com/BerriAI/litellm). Full upstream licenses:
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
