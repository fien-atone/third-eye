# Changelog

All notable changes to Third Eye are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] — 2026-04-23

### Added
- **Projects registry** — new `Projects` tab with searchable list of every
  project, sortable columns, custom labels, pinned favourites, and pagination.
- **Search** by visible label, auto-derived label, or raw filesystem key,
  with orange match highlighting and a secondary `Session: …` line that
  surfaces *why* a project matched when the hit isn't in the visible name.
- **Favourites** — pin projects to a separate block above the rest. ★ marker
  also shown on the Top Projects table on the dashboard.
- **Open in new tab** — rows in the Projects registry, the dashboard's
  Top Projects table, and the `Dashboard` / `Projects` tabs all use real
  `<a href>` elements, so ⌘/Ctrl-click and middle-click open in a new tab
  natively (stretched-link pattern).
- **Version badge** in the header (next to *Third Eye*) and footer (links
  to GitHub Releases for upgrade comparison).
- **Per-screen `<title>`** — browser tabs now show `Third Eye · Dashboard`
  / `Third Eye · Projects` / `Third Eye · <project name>` so multiple
  open tabs and bookmarks are distinguishable.
- **Reusable date primitives** `<DateCell>` and `<DateText>` — locale-aware
  formatting (`23 Apr 2026` / `23 апр. 2026`), tabular numerals, dim
  styling consistent across the app.
- **Middle-ellipsis truncation** for long paths: shows both the start
  (`~/Desktop/…`) and the meaningful end (`…/claude_stats`) instead of
  cropping the project identifier off.
- **CHANGELOG.md** (this file) and **UPGRADING.md** with a safe upgrade
  procedure.

### Changed
- **Column names** in the Projects registry: *First seen → Created*,
  *Last seen → Last updated* (across all 5 locales).
- **Default sort** on the Projects registry is now *Last updated* desc —
  most recently active projects float to the top, inactive ones sink.
- **`auto:` prefix** under the project name renamed to **`Session:`** —
  better aligned with Claude Code session-folder terminology.
- **Top Projects** table on the dashboard and **Project Activity** pills
  now respect custom labels (used to show raw paths only).
- **Sticky table header** is fully opaque and sits above row backgrounds
  (was bleeding through during scroll due to a `position: relative` layer).
- Sortable column headers now show a dim `↕` indicator on every sortable
  column — previously only the active column had a visible arrow, leaving
  the other columns looking unclickable.

### Removed
- **Project archiving** — replaced by natural sort-order falloff. The DB
  column is dropped from new installs; on existing installs it's left in
  place but ignored (data preserved if you ever want to bring it back).

### Fixed
- **White space inside table panels** — old `table-layout: fixed` had a
  ghost-width bug when columns were responsively hidden. Replaced with CSS
  Grid + subgrid so column widths are absorbed by `1fr` correctly. Avoid
  `container-type: inline-size` on grids with subgrid descendants — it
  collapses Chrome's grid sizing to track min-content.
- **Pill labels truncated to nonsense** (`Builder?` → `Bu…`) — `MidEllipsis`
  was over-eager when the parent flex container hugged content; added a
  4 px slack to the canvas-vs-DOM measurement comparison and removed
  `MidEllipsis` from inline-flex pill containers.
- **Search field migrated to the left** unexpectedly — `flex: 1 1 auto`
  on the controls wrapper made it stretch and search aligned to the wrong
  edge. Switched to fixed 360 px width pinned right.

### Internals
- Single-source-of-truth helpers added, eliminating ~40 inline duplications:
  - `resolveLabel()` — `custom_label ?? auto_label ?? key` priority.
  - `roundUsd()` — JSON-safe USD rounding (handles `null`/`NaN`).
  - `getProjectById/ByKey/sByKeys()` — typed project row lookups.
  - `api()` / `apiGet` / `apiPatch` / `apiPost` — fetch wrapper with
    consistent error handling.
  - `dashboardParams()` — URL-param builder that always includes
    `tzOffsetMin` (forgetting it makes server bucket calculations drift).
  - `projectSearchInfo()` — search-match logic with hint-line decisions.
- **CSS Grid + subgrid** replaces `<table>` for the Projects registry. Two
  separate grids (favourites + rest) share identical fixed column widths
  for visual alignment.
- **Responsive column priority cascade** via viewport media queries — drops
  `lastSeen → firstSeen → calls → cost` as the screen narrows.

## [1.2.1] — 2026-04-21

### Changed
- *Cost by project* panel renamed to **Project activity** across all
  locales — name now matches what users actually read off the chart
  (work intensity over time, not just a billing column).
- Subtitle clarifies axis: *USD per day, stacked by project*.

### Fixed
- **Right-side legend column removed** from Project activity panel — the
  240 px sidebar was eating chart width and breaking date-axis alignment
  with the charts below. Project legend now lives as inline pills above
  the chart, full-width row that wraps as needed; chart goes full panel
  width again, dates line up vertically with Cost by model / Tokens /
  API calls.

### Added
- **Smart label shortening** for project pills:
  - `~/Desktop/Inoise/Global/TTRPG/app` → `TTRPG/app`
  - `~/Desktop/Inoise/Global/dnd/character/builder` → `character/builder`
  - long Cowork prompt text → first ~22 chars + ellipsis.
  Pills show the compact form; hover (`title`) shows full label.

## [1.2.0] — 2026-04-20

### Added
- **Cost by project** panel (top of dashboard) — stacked bars per project
  over the selected period, top 8 by cost colored, rest grouped as
  *Other*. Click any legend row to drill into that project. Hidden in
  project view (already filtered to one project).

### Changed
- **Algorithmic model naming** — three hardcoded shortname maps
  (`models.ts`, `providers/claude.ts`, `ingest.ts`) replaced with a single
  regex-based `getShortModelName`. New Anthropic / OpenAI / Google models
  get sensible display names automatically (`claude-opus-5-0` → *Opus 5.0*,
  `gemini-3.0-pro` → *Gemini 3.0 Pro*). `OVERRIDES_SHORT` table kept for
  irregular cases only.
- **Pricing** unchanged — still fetched from LiteLLM at runtime with
  `startsWith`-family fallback; no per-model code needed for cost math.

## [1.1.1] — 2026-04-18

### Fixed
- **Date-range preset buttons** (`7d / 30d / 12w / MTD / 12m`) were
  hardcoded English and stayed that way regardless of UI language. Now
  localised in all 5 languages: `7д / 7天 / 7d / 7T`, etc.

## [1.1.0] — 2026-04-17

### Added
- **Workspaces-based Node install** — single `npm install` from repo
  root sets up both client and server.
- **Cross-platform scheduler** for periodic ingest (macOS / Windows / Linux).
- **User-facing README** and full **DOCS.md** (tech stack, API reference,
  scheduler, Windows specifics, cost calculation math, timezone handling).
- **Server-down banner** with recovery instructions when the backend isn't
  reachable.
- **AI-install prompt** — copy-paste prompt for installing via Claude Code.

### Changed
- **Top Projects arrows** promoted to a dedicated rightmost column (24 px
  wide, right-aligned) — they used to float at random positions inside the
  name cell depending on label length; now they line up on one vertical
  axis like a proper affordance column.

### Fixed
- **Tooltips** were lagging behind the cursor by ~400 ms — Recharts default
  position animation. Disabled animations on all tooltip components for
  snappy hover.

## [1.0.0] — 2026-04-15

Initial public release.

### Added
- **Self-hosted web dashboard** for AI coding spend across Claude Code,
  Claude Desktop / Cowork, and Codex CLI.
- **Cost / token / activity breakdowns** by day / week / month.
- **Per-project drill-down** with stable UUIDs in shareable URLs.
- **Ephemeral Cowork projects** labelled by first user message.
- **Project insights**: subagents, skills, MCP servers, Bash commands,
  file hotspots, workflow flags, Claude Code versions, branch activity,
  hour-of-week heatmap.
- **Timezone-aware** — UTC storage, client-local display, week-start per
  locale.
- **5 locales** (en, ru, zh, es, de) with persisted choice.
- **Light / Dark / System** theme.
- **Cross-platform** — macOS / Windows / Linux + Docker.

### Credits
- Adapted parser from [CodeBurn](https://github.com/codeburn/codeburn)
  (MIT) — see [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

[1.3.0]: https://github.com/inoise/third-eye/releases/tag/v1.3.0
[1.2.1]: https://github.com/inoise/third-eye/releases/tag/v1.2.1
[1.2.0]: https://github.com/inoise/third-eye/releases/tag/v1.2.0
[1.1.1]: https://github.com/inoise/third-eye/releases/tag/v1.1.1
[1.1.0]: https://github.com/inoise/third-eye/releases/tag/v1.1.0
[1.0.0]: https://github.com/inoise/third-eye/releases/tag/v1.0.0
