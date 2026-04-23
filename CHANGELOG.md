# Changelog

All notable changes to Third Eye are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] — 2026-04-24

The widget grid grows up. Every widget now responds to its own size:
lists fit by height, tables drop columns by priority, charts size to
the tile, KPIs scale via container queries, the heatmap fits exactly
or shows a "make me bigger" hint. Tooltips escape clipping ancestors
via React portals. Project rename moved to the project page itself.
App.tsx shrunk from 673 lines to 283 by extracting screen + control
components.

### Added
- **Fit-by-height for every list / table widget** — Top projects, File
  hotspots, Branches, Models, Subagents, Skills, MCP, Bash, and the
  Versions table render only as many rows as visibly fit. A footer
  chip below shows `Showing X of Y · N hidden` (or `All N shown` when
  everything fits) so users always know the dataset size. Replaces
  the old internal scrollbars.
- **Priority-based column hiding for the Models table** — `Model` and
  `Cost` are always visible; `Calls` / `Share` / `Input` / `Output` /
  `CacheR` / `CacheW` come back as the tile gets wider.
- **Donut ↔ table cross-highlight on the Versions widget** — hover a
  segment to highlight the matching row, hover a row to spotlight the
  matching segment (others dim to 35% opacity).
- **Project rename on the project detail page** — click ✎ next to the
  H1, edit inline, ✓ to save / ✕ to cancel / ⟲ to reset to auto.
  Mirrors the pattern from the projects list; refetches both queries
  so the new name shows up everywhere immediately.
- **Heatmap cell tooltip** — stylized portal popup with day, hour
  range, and call count. Hovered cell gets an accent outline; the
  matching day row + hour column labels go bold.
- **Always-on x-axis** on time-series charts so dates are readable
  even on a 2-row tile (was hidden below `h>=3`).
- **"Not enough space" fallback** for the Heatmap when the tile is
  too small to render a usable 7×24 grid.

### Changed
- **Tooltips render via React Portal** into `document.body` — they no
  longer get clipped by the tile's `overflow:hidden` boundary. Auto-
  flip near viewport edges. Tooltips also now show the **full
  localized date** (`Wednesday, 12 March 2026`) instead of the
  compact axis label.
- **Charts share a layout vocabulary** — `TIMESERIES_MARGIN`,
  `TIMESERIES_YAXIS_WIDTH=60`, and a `.widget-chart-body` /
  `.widget-chart-area` flex-column structure so the
  `ResponsiveContainer` always sees a real bounded height. Two
  time-series widgets at the same tile size now stack with axes
  visually aligned.
- **Activity widget** uses the same fit-by-height pattern as lists:
  shows only as many bars as can be drawn cleanly at the current
  height, hides its own x-axis if drawing it would shrink bars to
  invisibility, and shows the truncation chip when bars are dropped.
- **KPI value font scales via CSS container queries** at the tile
  level (≤320px → 18px, ≤240px → 16px, ≤180px → 14px). All four
  KPI tiles in a row pick the same font size at the same width —
  including the single-metric `Scope` tile that previously stayed
  20px while neighbours shrank.
- **Filter chips on Tokens / Versions hide on narrow tiles** (panel
  width <360px) and force the underlying view back to its default,
  so a user can't get stuck on a filtered slice they can't change.
- **Versions donut hides on widths <460px** — the table takes the
  full panel. When shown, the donut uses percent radii and stretches
  to the cell height (was clipped at h=2 with the old fixed 220px).
- **Versions / Tokens / Branches / Files / Models tables clip
  overflow at the cell** — long branch names use `MidEllipsis` and
  `table-layout: fixed` so the numeric columns never get pushed off
  the right edge.
- **Empty-slot placeholder behaviour during edit mode** — the dashed
  rectangles always render as drag-target guides, but the `+` button
  inside (and the per-tile "↑+" insert-row button) only shows when
  there's actually something in the catalog to add.
- **Layout-customize toolbar hidden under window width 720** —
  matches the existing `MOBILE_BREAKPOINT` where GridStack drag /
  resize is disabled anyway.
- **Insights widget subtitle ("PLAN MODE 0 / 0.0% from N calls"
  etc.)** clamped to one line on narrow tiles so a long localized
  subtitle doesn't eat into the body and starve `useFitCount`.
- **Project rename label unified** — `Session: …` is used on both
  the projects list and the project detail page (was `Location: …`
  on the detail page).
- **README** — bullet refresh + minor wording.

### Fixed
- **Charts no longer overflow the widget edge.** The pre-2.0 layout
  let `ResponsiveContainer` claim 100% of the panel body height
  while the legend stacked on top, so on narrow / short tiles the
  rendered SVG escaped the rounded panel border.
- **"Showing 0 of N" stuck state on cold mount** — when GridStack
  assigned the tile a real size after the first measurement,
  `useFitCount` had latched at 0 because no rows were rendered to
  measure. The hook now never falls below 1 from "no rows present"
  and re-measures correctly when the body comes online.
- **Vite dev proxy hangs on macOS** (cold-start API requests
  occasionally pending for 10s). The client in dev now hits the
  backend directly at `127.0.0.1:4317` (`api.ts` reads
  `import.meta.env.DEV`); the Vite proxy was rolling an
  IPv6/IPv4 lottery for every fresh socket and losing.
- **Project labels in subtitle no longer wrap to 2-3 lines on narrow
  tiles** — clamped to single-line ellipsis so the panel header has
  a predictable height.
- **`server.keepAliveTimeout` bumped to 65s** (Node default 5s).
  Browser keep-alive sockets were getting silently FIN'd between
  requests, making subsequent requests hang for ~10s as Chrome
  tried to reuse a closed socket. Pairs with `headersTimeout = 66s`
  per Node's required ordering.

### Internals
- **New hook `lib/use-fit-count.ts`** — measures container height +
  first-row height + footer height (via a `forwardRef` chip), works
  for both `<table>`-shaped (with `rowSelector: 'tbody > tr'`) and
  `<div>`-shaped row containers. Used by 9 widgets.
- **App.tsx 673 → 283 lines.** Extracted:
  - `screens/project-page.tsx` — project header (with rename) +
    insights query + `<Dashboard inProjectView>` composition.
  - `components/app-header.tsx` — brand, version, locale, theme,
    nav-tabs.
  - `components/dashboard-controls.tsx` — granularity, presets,
    date pickers, provider chips, edit toolbar, summary band.
  - `components/{date-field,locale-switcher,theme-toggle,footer,
    server-down-banner}.tsx` — small standalone components lifted
    out of App.
- **`api.ts` got `apiPut` / `apiDelete`** (in addition to existing
  `apiGet` / `apiPost` / `apiPatch`). Layout save/reset now use the
  centralised wrapper.
- **i18n: `widget.listMore.{count,hint,tip,compact,all}Fmt`** added
  across all 5 locales for the new truncation chip; `insights.heatmap.
  {tooSmall,cellCalls}` for the heatmap fallback + tooltip.

## [1.4.0] — 2026-04-23


### Added
- **Customizable widget dashboards** — both the Dashboard and Project
  view are now grids of draggable, resizable widgets. Click **Customize**
  (gear icon, right side of the controls bar) to enter edit mode: drag
  the title bar to reposition, drag the bottom-right corner to resize,
  click `×` to remove a widget. An **Add widget** button below the grid
  shows everything in the catalog that isn't currently placed.
- **Per-screen layouts persisted in the DB** — your customizations
  travel with the SQLite file across machines. No more re-arranging
  from scratch when you migrate.
- **Reset to defaults** button in edit mode — restores the screen's
  factory layout (with confirmation).
- **15 widgets** to mix and match: 4 KPI groups, 7 dashboard
  charts/tables (Project activity, Cost by model, Tokens, API calls,
  Models, By activity, Top projects) + 9 project-page insights
  (Subagents, Skills, MCP servers, Bash, File hotspots, Workflow flags,
  Versions, Branches, Heatmap).

### Changed
- **Default Dashboard layout** matches the previous static order — new
  installs and existing users (on first launch of v1.4.0) see exactly
  the layout they're used to. Customization is opt-in.
- Charts now fill the widget tile dynamically instead of using fixed
  pixel heights — resize a widget bigger and the chart scales with it.

### Internals
- New table `screen_layouts` (seeded once on first start, never
  overwritten thereafter — same idempotent migration pattern as the
  rest of the schema).
- API: `GET/PUT /api/layout/:screen` for layouts, `DELETE /api/layout/:screen`
  for reset-to-default.
- New module `client/src/widgets/grid.tsx` (`<WidgetGrid>`,
  `<AddWidgetPicker>`, `useScreenLayout`) — generic and screen-agnostic;
  any future screen plugs in by passing its own catalog and screen id.
- Mobile (≤720px): grid renders as a read-only single-column stack in
  the saved y-order; edit mode is disabled. Avoids per-breakpoint
  layout proliferation while keeping content reachable.
- Built on `react-grid-layout` 1.5.x — proven, single-purpose library
  for resizable dashboards (used by Grafana-style tools for years).

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

[1.4.0]: https://github.com/inoise/third-eye/releases/tag/v1.4.0
[1.3.0]: https://github.com/inoise/third-eye/releases/tag/v1.3.0
[1.2.1]: https://github.com/inoise/third-eye/releases/tag/v1.2.1
[1.2.0]: https://github.com/inoise/third-eye/releases/tag/v1.2.0
[1.1.1]: https://github.com/inoise/third-eye/releases/tag/v1.1.1
[1.1.0]: https://github.com/inoise/third-eye/releases/tag/v1.1.0
[1.0.0]: https://github.com/inoise/third-eye/releases/tag/v1.0.0
