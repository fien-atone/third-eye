# Third Eye

Self-hosted web dashboard for your AI coding spend across **Claude Code**,
**Claude Desktop / Cowork**, and **Codex CLI**. Reads session transcripts from
disk, ingests them into a local SQLite DB, and serves a React UI with cost,
token, and activity breakdowns over time.

## Tech stack

- **Runtime**: Node.js 20+ (single language end-to-end)
- **Backend**: Express · TypeScript · `tsx` (no build step) · `better-sqlite3` (synchronous, file-based)
- **Storage**: SQLite with WAL mode · single file · shareable as-is
- **Frontend**: React 19 · TypeScript · Vite · TanStack Query (server state, optimistic UI)
- **Charts**: Recharts (industry-standard declarative SVG)
- **Dates**: date-fns v4 with all 5 UI locales (`en-US`, `ru`, `zh-CN`, `es`, `de`)
- **Styling**: plain CSS with theme tokens · custom dark/light/system modes
- **i18n**: zero-dependency typed dictionaries · `<html lang>` + persistent locale
- **Container**: multi-stage Dockerfile · `docker compose` orchestration

Deliberate non-choices: no ORM (SQL is prepared statements, schema is tiny), no
CSS framework, no state-management library (React Query covers server state,
component state for the rest), no routing library (hash-based router in ~30
lines fits the app).

## Install

Docker is the **primary, recommended** path — zero host setup beyond Docker
itself, one command, works identically on macOS / Linux / Windows. The Node
path exists for people who already have a Node workflow or can't run Docker.

### Option A — Docker (recommended)

```bash
git clone https://github.com/fien-atone/third-eye
cd third-eye
docker compose up -d --build
```

Open http://localhost:4317. The container:
- Reads `~/.claude` and `~/.codex` from the host (read-only mounts)
- Persists SQLite to `./server/data/` on the host
- Auto-refreshes ingest every 15 minutes (configurable in `docker-compose.yml`)
- Uses the fallback `${USER_HOME:-${HOME:-${USERPROFILE}}}` so Windows and Unix
  both just work

Stop with `docker compose down`.

### Option B — Node (no Docker)

For people who have Node and prefer a plain process.

```bash
git clone https://github.com/fien-atone/third-eye
cd third-eye
npm install           # installs server + client via workspaces
npm start             # builds client, starts server on :4317
```

Open http://localhost:4317. One port, no client dev server — the built client
is served as static files by the server.

Run as a background service via your tool of choice (`pm2`, `systemd`, `launchd`,
Windows Service) pointing at `server/index.ts` with `tsx`.

### Option C — Dev mode (hot reload, contributors)

Two processes with HMR, source-map-friendly. Only needed if you're editing code.

```bash
npm install
npm run dev           # starts both server (:4317) and Vite client (:5173)
```

Open http://localhost:5173. Vite proxies `/api/*` to the server.

## Ingest scripts

All standard ingests are **idempotent** — they upsert by message dedup key, so
re-running is safe and produces no duplicates.

```bash
npm run ingest            # full rescan (safe, default)
npm run ingest:hour       # last hour only
npm run ingest:day        # last 24h
npm run ingest:week       # last 7 days

# custom window:
npm --prefix server run ingest -- --since=30m
npm --prefix server run ingest -- --since=3d
```

Or via HTTP (the **Refresh** button in the UI calls this):

```bash
curl -X POST http://localhost:4317/api/refresh                # full
curl -X POST 'http://localhost:4317/api/refresh?since=1h'     # incremental
```

### Destructive rebuild

`ingest:rebuild` is the only destructive command. It wipes and re-ingests from
scratch — use it after classifier/pricing changes, to remove stale projects,
or if dedup state is suspected corrupted. Safeguards:

- Interactive prompt requires typing the word **`rebuild`**; anything else cancels
- In non-interactive shells (pipes, cron, CI) the command refuses without `--yes`
- Regenerates project UUIDs → existing `#/project/<uuid>` bookmarks break

```bash
npm run ingest:rebuild               # interactive
npm --prefix server run ingest:rebuild -- --yes   # cron/CI
```

### Automated hourly refresh (non-Docker)

**One command**, cross-platform:

```bash
npm run schedule:install      # register hourly ingest
npm run schedule:status       # check it's live + see recent log
npm run schedule:uninstall    # remove
```

What it does under the hood, per OS:

| Platform | Mechanism | Where it lives |
|---|---|---|
| macOS   | `launchd` user agent | `~/Library/LaunchAgents/org.thirdeye.ingest.plist` |
| Linux   | `cron` user crontab  | `crontab -l` (tagged `# org.thirdeye.ingest`) |
| Windows | `schtasks` user task | Task Scheduler → `ThirdEyeIngest` |

Runs `npm run ingest:hour` every hour. Uses absolute paths to `npm` so it
works under `nvm`, Homebrew, `fnm`, etc. Logs go to `~/.third-eye-ingest.log`.
Safe to run the installer multiple times — it replaces any existing entry.

**Inside Docker** — nothing to install. `CODEBURN_INGEST_INTERVAL_MIN` env
controls in-container auto-refresh (default: 15 min / window 2h).

## Windows specifics

- Session paths auto-detect — Claude Code, Desktop/Cowork, Codex are all found
  under `%USERPROFILE%` / `%APPDATA%` without any config.
- If `npm install` fails on `better-sqlite3` with a node-gyp error, install
  **Visual Studio Build Tools** with the "Desktop development with C++"
  workload and retry. One-time Windows prerequisite for any native Node module.
- `docker-compose.yml` uses a `${USER_HOME:-${HOME:-${USERPROFILE}}}` fallback
  chain — picks the right home on any shell. If none are set, create a `.env`
  next to `docker-compose.yml` with `USER_HOME=C:\Users\your-name`.

## Sharing your data

SQLite is a single file (`server/data/third-eye.db`). To share your stats:

1. Copy the `.db` file to another machine.
2. Run Third Eye there without mounting `~/.claude` / `~/.codex` — the data is
   already in the DB. In Docker, just remove those volume lines.
3. Disable auto-ingest (`CODEBURN_INGEST_INTERVAL_MIN=0`) so it doesn't try to
   rescan non-existent session folders.

**Privacy note**: for Cowork ephemeral sessions, project labels are the first
user message of each task. If you share the DB, the recipient sees these. If
sensitive, only share the code and let the recipient build their own DB.

## API

| Endpoint | Description |
|---|---|
| `GET /api/providers` | Provider list with totals and `lastIngestAt` |
| `GET /api/projects`  | Project list with `id` (UUID), `key`, `label`, totals |
| `GET /api/overview?granularity=day\|week\|month&start=YYYY-MM-DD&end=YYYY-MM-DD&providers=all\|claude,codex&projectId=<uuid>&tzOffsetMin=<min>&weekStartsOn=<0-6>` | Time series + breakdowns |
| `GET /api/insights/:projectId?...` | Per-project insights (subagents, skills, MCP, bash, files, versions, branches, heatmap) |
| `POST /api/refresh[?since=<dur>\|?full=1]` | Trigger ingest, returns stats |
| `GET /api/health` | Health check (used by Docker healthcheck) |

## Features

- **Day / Week / Month** aggregation with shared toolbar
- Date range **presets** (7d, 30d, 12w, MTD, 12m) and custom **calendar picker** (localized, week start per locale)
- Provider filter chips (All / Claude Code / Codex); Insights hide when Claude excluded
- **Light / Dark / System** theme (persisted)
- Stacked bar charts for cost-by-model, tokens-over-time, API calls
- Token chart filter: Both / I/O only / Cache only
- Combined Models panel with inline cost-share bars
- **Per-project drill-down** via UUID in the URL hash (shareable)
- Project Insights: subagents, skills, MCP servers, Bash commands, file hotspots, Plan Mode / TodoWrite flags, Claude Code version distribution (donut + toggle by Cost/Calls/Tokens), git branches, 7×24 hour-of-week heatmap
- **Timezone-aware** throughout: UTC storage, client-local display, week-start per locale
- **i18n**: English · Русский · 简体中文 · Español · Deutsch
- Stay-visible loading on filter changes (no flicker)
- Empty-states and 404 page for unknown routes / missing projects

## Calculations

Cost per API call:

```
cost = input_tokens   * input_rate
     + output_tokens  * output_rate
     + cache_write    * cache_write_rate
     + cache_read     * cache_read_rate
     + web_search     * web_search_rate
```

Multiplied by `fastMultiplier` when `usage.speed === 'fast'` (Opus 4.6 = 6×).
Pricing fetched from LiteLLM's public catalogue, cached 24h, with hardcoded
fallback on network failure.

**Averages** are divided by active periods, not by the calendar window — a
$78 spend across 2 active days is reported as $39/day, not $2.61/day.

Deduplication is by `message.id` for Claude Code and by a synthetic key for
Codex — both unique primary keys in `api_calls`, so re-ingest is safe.

## Project layout

```
webapp/
├── package.json      Workspace root (scripts: start, dev, ingest:*, build)
├── client/           Vite + React UI
├── server/
│   ├── index.ts      Express HTTP server
│   ├── ingest.ts     CLI + library entry for ingestion
│   ├── db.ts         better-sqlite3 wrapper, schema, migrations
│   ├── lib/          Vendored session parser (see Credits)
│   └── data/         SQLite DB file (gitignored)
├── Dockerfile        Multi-stage build (client + server)
├── docker-compose.yml
├── LICENSE           MIT
└── THIRD_PARTY_NOTICES.md
```

## License

MIT — see [LICENSE](./LICENSE). Copyright © 2026 Ivan Shumov &lt;contact@ivanshumov.com&gt;

## Acknowledgements

Thanks to **[CodeBurn](https://github.com/AgentSeal/codeburn)** by
[AgentSeal](https://agentseal.org) — an MIT-licensed CLI for AI coding spend
tracking. Files in `webapp/server/lib/` (parser, classifier, models, provider
adapters) are vendored from CodeBurn and carry attribution headers.

Pricing data is fetched at runtime from
[LiteLLM](https://github.com/BerriAI/litellm). Full upstream licenses live in
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
