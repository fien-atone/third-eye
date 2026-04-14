# Third Eye

A web dashboard for AI coding spend. Reads Claude Code and Codex session
transcripts from disk, ingests them into a local SQLite database, and serves a
React UI with cost / token / activity breakdowns over time.

## Stack

- **Server**: Node + Express + tsx + **better-sqlite3**. Parses session JSONL
  files, upserts into SQLite by deduplication key.
- **Client**: Vite + React + TypeScript + Recharts + TanStack Query.
- **DB**: SQLite (single file `server/data/third-eye.db`, WAL mode). Shareable
  as one file.
- **Docker**: multi-stage image (~250 MB) with optional auto-ingest on a timer.

## Dev quickstart

```bash
# Terminal 1
cd server
npm install
npm start            # first run ingests all sessions into DB (~3s), serves :4317
```

```bash
# Terminal 2
cd client
npm install
npm run dev          # :5173, /api proxied to :4317
```

Open http://localhost:5173.

## Ingest scripts

All standard ingests are **idempotent** — they upsert by message dedup key, so
re-running is safe and produces no duplicates.

```bash
npm run ingest            # full rescan (safe, default)
npm run ingest:full       # explicit full
npm run ingest:hour       # last hour only
npm run ingest:day        # last 24h
npm run ingest:week       # last 7 days

# custom window:
npm run ingest -- --since=30m
npm run ingest -- --since=3d
npm run ingest -- --help
```

### Destructive rebuild

`ingest:rebuild` is the only **destructive** command. It wipes `api_calls`,
`projects`, and ingest meta, then re-ingests from scratch. Use it when:

- The classifier or pricing logic changed and you want every row recomputed
- Stale projects (deleted from disk) should disappear from the dashboard
- You suspect dedup state is corrupted

```bash
npm run ingest:rebuild               # interactive: prompts you to type "rebuild"
npm run ingest:rebuild -- --yes      # cron/CI: skip the prompt
```

Safeguards:

- Interactive prompt requires you to type the word `rebuild` (anything else cancels)
- In non-interactive shells (pipes, cron, CI) the command **refuses** to run
  unless `--yes` / `-y` is given — accidental `| tee` won't nuke the database
- A rebuild regenerates project UUIDs, so any `#/project/<uuid>` bookmarks
  break — the prompt warns about this

Or via the API (the **Refresh** button in the UI calls this):

```bash
curl -X POST http://localhost:4317/api/refresh                # full
curl -X POST 'http://localhost:4317/api/refresh?since=1h'     # incremental
```

### Cron example

Hourly incremental + nightly full rebuild:

```cron
5 * * * *  cd /path/to/webapp/server && /usr/local/bin/npm run ingest:hour --silent >> /tmp/third-eye.log 2>&1
30 3 * * * cd /path/to/webapp/server && /usr/local/bin/npm run ingest:full --silent >> /tmp/third-eye.log 2>&1
```

## Docker

One container — server + pre-built client + optional auto-ingest on a timer.

```bash
cd webapp
docker compose up -d --build
```

Open http://localhost:4317. Static UI and API on the same port.

The compose file:

- Mounts `~/.claude` and `~/.codex` read-only into the container
- Persists SQLite to `webapp/server/data/`
- Runs incremental ingest every 15 minutes (last 2h window) by default

Adjust the schedule via env in `docker-compose.yml`:

```yaml
CODEBURN_INGEST_INTERVAL_MIN: "15"   # 0 disables auto-ingest
CODEBURN_INGEST_SINCE: "2h"          # window per auto-run
```

### Manual ingest inside the container

```bash
docker compose exec third-eye npm run ingest:hour
docker compose exec third-eye npm run ingest:full
```

### Plain `docker run` (no compose)

```bash
cd webapp
docker build -t third-eye .

docker run -d --name third-eye -p 4317:4317 \
  -v "$HOME/.claude:/data/claude:ro" \
  -v "$HOME/.codex:/data/codex:ro" \
  -v "$PWD/server/data:/app/server/data" \
  -e CODEBURN_INGEST_INTERVAL_MIN=15 \
  third-eye
```

## Windows

The project runs natively on Windows 10/11 via Node.js. Session data paths are
auto-detected per platform (see `server/lib/providers/claude.ts`).

### Dev setup (PowerShell)

```powershell
# Terminal 1
cd server
npm install          # first run may compile better-sqlite3; prebuilt binaries usually avoid this
npm start
```

```powershell
# Terminal 2
cd client
npm install
npm run dev
```

If `npm install` fails on `better-sqlite3` with a node-gyp error, install
**Visual Studio Build Tools** with the "Desktop development with C++" workload,
then retry. This is a one-time Windows prerequisite for any native Node module.

### Docker on Windows

Docker Desktop on Windows runs the Linux container unchanged. The compose file
already uses a fallback chain `${USER_HOME:-${HOME:-${USERPROFILE}}}` so it
picks the right home on any platform.

If for some reason none of those vars are set in your shell, create a `.env`
file next to `docker-compose.yml`:

```
USER_HOME=C:\Users\your-name
```

Then `docker compose up -d --build` works the same as on macOS/Linux.

### Scheduled ingest on Windows (Task Scheduler)

The cron examples in this README are Unix-only. On Windows use Task Scheduler:

1. Open **Task Scheduler** → **Create Task**
2. Trigger: "On a schedule" → Daily, repeat every 1 hour
3. Action: **Start a program**
   - Program: `powershell.exe`
   - Arguments: `-NoProfile -Command "cd 'C:\path\to\webapp\server'; npm run ingest:hour"`
4. Save. Optionally set "Run whether user is logged on or not" for background runs.

Or, if the Docker container is running, just let `CODEBURN_INGEST_INTERVAL_MIN`
do the scheduling inside the container — no host-side scheduling needed.

## Sharing your data

SQLite is a single file. To share your stats:

1. Copy `server/data/third-eye.db` to another machine.
2. Start the server / container there **without** mounting `~/.claude` — the
   data is already in the DB.
3. Disable auto-ingest (`CODEBURN_INGEST_INTERVAL_MIN=0`) so it doesn't try to
   re-scan empty session folders.

## API

| Endpoint | Description |
|---|---|
| `GET /api/providers` | Provider list with totals and `lastIngestAt` |
| `GET /api/projects`  | Project list with `id` (UUID), `key`, `label`, totals |
| `GET /api/overview?granularity=day\|week\|month&start=YYYY-MM-DD&end=YYYY-MM-DD&providers=all\|claude,codex&projectId=<uuid>` | Time series + breakdowns |
| `POST /api/refresh[?since=<dur>\|?full=1]` | Trigger ingest, returns stats |
| `GET /api/health` | Health check (used by Docker healthcheck) |

## Features

- Day / Week / Month aggregation with shared toolbar
- Date range presets (7d, 30d, 12w, MTD, 12m) and custom inputs
- Provider filter chips (All / Claude Code / Codex)
- Light / Dark / System theme toggle (persisted in localStorage)
- Stacked bar charts for cost-by-model and tokens-over-time
- Token-chart filter: Both / I/O only / Cache only
- Combined Models panel with inline cost-share bar
- Per-project drill-down via UUID in the URL hash (shareable)
- KPI groups: Spend / Tokens / Cache / Scope

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
Pricing is fetched from LiteLLM's public model catalogue and cached for 24h
(falls back to a hardcoded table on network failure).

Deduplication is by `message.id` for Claude Code and by a synthetic key for
Codex — both indexed in the `api_calls` table as a unique primary key, so
re-ingest is safe.

## Project layout

```
webapp/
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

Third Eye is released under the **MIT License** — see [LICENSE](./LICENSE).

Copyright © 2026 Ivan Shumov &lt;contact@ivanshumov.com&gt;

## Acknowledgements

This project would not exist without **[CodeBurn](https://github.com/AgentSeal/codeburn)**
by [AgentSeal](https://agentseal.org) — a terrific MIT-licensed CLI for AI
coding spend tracking that solved the hardest part of the job long before this
dashboard was started. Huge thanks to the CodeBurn authors for releasing it
openly.

The following files in `webapp/server/lib/` are vendored from CodeBurn (each
preserves an attribution header):

| File | Purpose |
|---|---|
| `parser.ts` | JSONL session reader, deduplication, project aggregation |
| `models.ts` | LiteLLM pricing fetch, fallback table, cost calculation |
| `classifier.ts` | 13-category turn classifier (coding, debugging, etc.) |
| `bash-utils.ts` | Bash command extraction from tool calls |
| `types.ts` | Shared type definitions for sessions, turns, usage |
| `providers/index.ts` | Provider registry |
| `providers/types.ts` | Provider interface |
| `providers/claude.ts` | Claude Code session discovery |
| `providers/codex.ts` | Codex JSONL parser, tool name normalization |

What this project adds on top:

- SQLite ingest layer with WAL mode, indexed schema, and stable per-project
  UUIDs (`server/db.ts`, `server/ingest.ts`)
- Express HTTP API with provider/project/date filtering and bucketed time-series
  aggregation in SQL (`server/index.ts`)
- React + Recharts dashboard: stacked bar charts, token I/O vs cache filter,
  inline cost-share bars, KPI groups, light/dark/system themes, hash routing
  for shareable per-project URLs (`client/`)
- Docker packaging with optional in-container scheduled re-ingest
- Branding (Third Eye name, logo, palette)

Pricing data is fetched at runtime from
[LiteLLM](https://github.com/BerriAI/litellm). Full upstream licenses are in
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
