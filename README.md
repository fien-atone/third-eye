# Third Eye

**See where your AI coding money goes.**

Self-hosted dashboard that reads your **Claude Code**, **Claude Desktop / Cowork**,
and **Codex CLI** session files from disk and shows you — in plain charts —
how much you actually spent, on what, and when. No signup. No cloud. Your
data never leaves your machine.

---

## Why?

If you use AI coding agents every day, you probably have no clue how much that
actually costs you.

- Which model burns the most tokens — Opus or Sonnet?
- Which of your projects eats your AI budget?
- Do you spend more on debugging or writing new code?
- Is prompt caching actually saving you anything?
- When do you work, really?

The provider billing dashboards don't answer these. **Third Eye does**, at
per-call granularity, across every session you ever ran — including the
ephemeral ones from Cowork.

## What you get

- **Cost breakdowns** by model, project, activity, git branch — any date range, any aggregation (day / week / month)
- **Per-project drill-down** — click any project, get the full story: files you edit most, tools you invoke, subagents you spawn, skills you trigger, MCP servers you lean on
- **Projects registry** — search, sort, rename, pin favourites; ⌘/Ctrl/middle-click any row to open the project in a new tab
- **Customizable widget dashboards** — drag, resize, add and remove widgets on both the Dashboard and per-project view; every widget adapts to the size you give it (lists fit by row count, tables drop columns by priority, KPIs scale text via container queries, the heatmap sizes its cells exactly); layouts saved to your local DB and travel with the file across machines
- **Activity heatmap** — 7×24 grid showing when you actually work on each project
- **Claude Code version tracking** — see which CLI versions touched each project, distribution by cost / calls / tokens
- **Shareable project URLs** — stable UUID in the hash, bookmark it, send it
- **Everything is local** — SQLite file on your disk, you control it and can share it as-is
- **5 languages** · Light / Dark / System theme · timezone-aware · mobile-friendly

## Quick start

### Docker (recommended)

```bash
git clone https://github.com/fien-atone/third-eye
cd third-eye
docker compose up -d --build
```

Open http://localhost:4317. The container mounts your `~/.claude` and `~/.codex`
read-only, re-ingests every 15 minutes, and survives reboots.

### Node (no Docker)

```bash
git clone https://github.com/fien-atone/third-eye
cd third-eye
npm install
npm start
```

Open http://localhost:4317. To auto-refresh hourly:

```bash
npm run schedule:install
```

### Let an AI do it for you

If you'd rather just tell your AI assistant, paste this prompt into Claude Code,
Cursor, ChatGPT, or any other coding AI:

> I want to install Third Eye, a self-hosted dashboard for AI coding spend.
> Repo: https://github.com/fien-atone/third-eye
>
> Please do this for me:
>
> 1. Clone it somewhere sensible under my home directory.
> 2. Pick the best install method for my system — Docker if I have it running
>    (preferred), otherwise Node 20+ via `npm install && npm start`.
> 3. Start it and verify `http://localhost:4317` responds.
> 4. Set up hourly auto-ingest so data stays fresh:
>    - Docker: nothing to do, it's on by default.
>    - Node: run `npm run schedule:install`.
> 5. Open http://localhost:4317 in my default browser.
>
> Stop and ask me before making any ambiguous decision (e.g., exposing beyond
> localhost, picking a non-default port). Show me the URL at the end.

The AI will handle OS quirks, missing tools, and whether you'd rather have
Docker or a plain process.

## Privacy

Your session files never leave your machine. Third Eye only reads `~/.claude`
and `~/.codex` as-is. The server binds to `localhost` by default. The SQLite
DB lives on your disk — you choose whether and how to share it.

Drilled-in project labels include the first user message of each ephemeral
Cowork session (that's how we turn `wizardly-charming-thompson` into something
readable). If you share the `.db` file, recipients can read those prompts. If
that's sensitive, share the **code** and let each person build their own DB
from their own sessions.

## Screenshots

*Coming soon — this dashboard is designed for your real data, so the most
honest screenshots are the ones you make yourself once it's running.*

## Documentation

- **[DOCS.md](./DOCS.md)** — tech stack, API reference, full ingest / scheduler
  docs, Windows specifics, cost calculation math, timezone handling,
  dev-mode setup, project layout, data-sharing how-to.
- **[UPGRADING.md](./UPGRADING.md)** — safe upgrade procedure for new
  releases. TL;DR: back up the DB file, then `git pull && npm install &&
  npm start` (or `docker compose pull && docker compose up -d --build`).
- **[CHANGELOG.md](./CHANGELOG.md)** — what's new in each release, fixes,
  removals, and internals worth knowing.
- **[ROADMAP.md](./ROADMAP.md)** — what's planned, what's considered, and
  what we explicitly decided not to do.

## License & credits

MIT — see [LICENSE](./LICENSE). © 2026 [Ivan Shumov](mailto:contact@ivanshumov.com).

The session parser is adapted from
[CodeBurn](https://github.com/AgentSeal/codeburn) by AgentSeal (MIT) — huge
thanks for solving the hardest part of the job. Pricing data from
[LiteLLM](https://github.com/BerriAI/litellm). Full attributions in
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
