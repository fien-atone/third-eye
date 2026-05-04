# Changelog

All notable changes to Third Eye are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.6.2] — 2026-05-04

A small follow-up focused on the Codex plan-history widget and
the day-view heatmaps. The widget is now wired into Today with
an hourly axis, the 7d-window overlay tells the truth about
inactivity gaps instead of fabricating a flat trend through them,
and empty heatmap cells are finally visible in the dark theme.

### Added

- **Hourly Codex plan chart on Today.** The same per-plan stacked
  view that the Dashboard renders for multi-day ranges now also
  shows up on the Today screen with a 24-hour axis. `/api/overview`
  gained a single-day + `granularity=hour` branch that re-parses
  the day's JSONL files into 24 hour buckets on the fly (no DB
  schema change — the per-day `codex_plan_daily` cache already
  collapses hour info). Existing Today layouts in the wild stay
  unchanged; users opt in via Reset layout or Customize.
- **Authoritative limit-hit markers.** A bar that hit
  `usage_limit_exceeded` for a given plan during its bucket now
  carries a thin red strip flush against its top edge, sourced
  from the same JSONL events that drive the limit-hit tooltip
  count. Reads as "this is the bar where you got blocked"
  without inflating the bar's % reading.

### Fixed

- **Plan-history tooltip rendered semi-transparent.** The inline
  style referenced `var(--surface)`, a token that doesn't exist
  in either theme, so the tooltip blended into the chart behind
  it. Swapped to the shared `.tooltip` class already used by
  every other widget tooltip.
- **7d-window line lied about long inactivity gaps.** The overlay
  used `connectNulls=true` and would draw a flat trend across
  weeks of zero activity, even though the rolling counter
  actually drains to zero after ~7 days idle. The line now
  breaks across long gaps (≥7 days of empty buckets, expressed
  per granularity: hour 168, day 7, week/month 1) and
  carry-fills short ones so a quiet weekend mid-streak still
  reads as one continuous line.
- **7d-window line crashed to zero on Today.** The hour and day
  Codex aggregators reported `secondaryPct=0` for buckets that
  had samples but no codex `limit_id` carrying
  `secondary.used_percent` (e.g. a premium-only hour). Both now
  return `null` in that case (= "not measured"), letting the
  carry-fill above bridge it on short gaps and the connectNulls
  break it on long ones. Existing rows in `codex_plan_daily`
  keep their stale 0 until the next ingest re-aggregates them.
- **Plan-history per-day bucketing + readable chart.** Multi-day
  ranges now group correctly by day instead of merging buckets,
  and the grouped bars match the per-plan breakdown shown in the
  tooltip side-by-side instead of stacking into 200%+ towers.
- **Dashboard data didn't refetch when an auto-tick landed.** The
  ingest tick wrote new rows but the dashboard's react-query
  cache held the stale snapshot until a manual Refresh; now the
  client invalidates the relevant queries when the tick reports
  fresh data.
- **Empty cells invisible in day-view heatmaps under dark theme.**
  The three day-view heatmaps (days×hours grid, weekday×hour
  matrix, single-day hour strip) painted empty cells with
  `var(--bg-2)`, which in the dark theme is the same `#111113`
  as the widget panel underneath. Switched to `var(--panel-2)`,
  which is defined as "one step away from --panel" in both
  themes (light `#f9f9fa`, dark `#17171a`); the empty grid now
  reads in either theme.

## [2.6.1] — 2026-05-03

The Rebuild flow shipped in 2.6.0 had a foot-gun and a few visual
gaps. This patch makes it actually usable: the user picks what
gets wiped, sees clear feedback during and after the operation,
and the dashboard reflects layout resets without a page reload.

### Added

- **Selective Rebuild.** The Rebuild dialog now has three opt-in
  checkboxes for the destructive extras — favorited projects +
  custom labels, agent role configuration, saved widget layouts.
  All default OFF. Telemetry tables (api_calls, tool_events,
  agent_sessions, codex_plan_daily) are always wiped — that's
  what Rebuild is for. Server accepts
  `?reset=projects,agents,layouts` on `POST /api/refresh?mode=rebuild`.
- **Success line in Settings.** A successful Rebuild now keeps
  the modal open and shows a green "Done — N rows re-imported in
  X.Xs" line under the button. Previously the modal closed
  silently on success, which made the operation feel like
  nothing happened.
- **`ApiError` class.** The `api.ts` wrapper now parses non-2xx
  bodies as JSON when shaped that way and exposes `code` (e.g.
  "busy" — 409 Conflict from the ingest lock) plus the full
  `body`. Existing string-compares (`err.message === 'busy'`) Just
  Work — the message becomes the code when one is present.

### Fixed

- **Rebuild used to silently nuke favorites + agent role config.**
  `truncateAll` always wiped `projects` and `agent_registry` along
  with telemetry, with no UI to opt out. Now those tables are only
  cleared when the user explicitly checks the matching box in the
  Rebuild dialog. Bug-fix, not behavior change — the previous
  behavior wasn't intentional.
- **"Reset saved widget layouts" didn't apply without a page
  reload.** The grid's layout query was invalidated but
  react-query returned the stale cached layout synchronously on
  WidgetGrid's remount, so GridStack initialized with old
  positions and the fresh data had nowhere to land. Now the cache
  entry is evicted (`removeQueries` not `invalidateQueries`)
  before the layoutEpoch bump, so the next mount has no stale
  data to fall back on and the grid re-renders to defaults right
  away.
- **409 Conflict from the lock surfaced as raw JSON.** When the
  user clicked Rebuild while an auto-tick was in flight, the old
  api wrapper threw the entire response body as the error
  message; the rebuild handler's `err.message === 'busy'` check
  never matched and the UI fell through to a generic-error path
  that printed the JSON dump verbatim. The new `ApiError` parses
  the body and surfaces the friendly "ingest is running, try
  again" hint as designed.
- **`codex_plan_daily` rows survived Rebuild.** Telemetry-derived
  table missed the `truncateAll` list (added in 2.5.0 after the
  helper was last touched). Practically harmless — the next
  ingest re-aggregated it — but semantically inconsistent with
  "wipe and re-import". Added.

## [2.6.0] — 2026-05-03

The hands-off release. Auto-ingest now runs as a configurable
in-app timer instead of forcing the user to either click Refresh
on a schedule or wire up an environment variable at boot. Every
ingest path — manual click, auto-tick, or destructive Rebuild —
goes through a single in-process lock so they can never overlap;
the header surfaces "something is happening" with an immediate
blue pulse so the user can tell the dashboard isn't stale.

### Added

- **In-app auto-refresh.** New Settings → Auto-refresh section
  with a toggle + interval dropdown (1m / 5m (default) / 15m /
  1h, plus 30s in dev). Off by default — opt-in. The timer is
  hot-reloadable: changing the interval or toggling the feature
  applies without a server restart. The legacy
  `THIRD_EYE_INGEST_INTERVAL_MIN` env var still works in parallel
  for container-driven scheduling.
- **Ingest lock with two policies.** Manual Refresh and the
  auto-tick share the dedup policy: a second caller piggy-backs
  on whatever is in-flight instead of spawning a parallel scan.
  Rebuild uses refuse policy and returns 409 Conflict when
  busy, since racing TRUNCATE with concurrent upserts would
  corrupt history. The new `ingestInProgress` field on
  `/api/health` surfaces the active kind so the UI can show a
  unified spinner regardless of who triggered the ingest.
- **Maintenance → Rebuild.** New Settings section with a single
  destructive entry: re-create the local DB from `~/.claude/projects`
  and `~/.codex/sessions` from scratch. Gated behind a confirm
  dialog spelling out exactly what gets wiped (api_calls,
  agent_sessions, projects, metadata) versus what stays (saved
  widget layouts, settings). Catches the lock's 409 with a
  friendly "ingest is running, try again" hint.
- **Live "is ingesting" signal in the header.** The pulse dot
  next to the last-refresh timestamp turns blue and pulses 2×
  faster while any ingest is in flight (manual or auto), with the
  tooltip flipping to "Auto-refresh in progress". The signal
  reacts synchronously to a manual click — no 3-second polling
  lag while waiting for the next /api/health to confirm what we
  already know we just kicked off. The relative timestamp itself
  also ticks forward every 30 s so "just now" doesn't freeze
  for the lifetime of the tab.

### Changed

- **Refresh button no longer jiggles the layout.** The label
  flips between "Refresh" and "Refreshing…" of different widths
  used to scoot the locale switcher and theme toggle left/right
  on every tick. Both labels now render stacked in a single grid
  cell so the button width is intrinsically the wider of the
  two — works in every locale without per-translation magic.
- **Release pipeline gates publish on build + test.** The release
  workflow used to run `publish` in parallel with the main-branch
  build; if the build broke, the GitHub Release page got created
  anyway (this happened on v2.5.0 first try). `release.yml` now
  has its own build + test jobs that mirror CI, and `publish`
  declares `needs: [build, test]` — no green CI, no release page.
  `scripts/release.sh` also runs the same gates locally before
  bumping versions, catching errors before they ever reach
  origin.

### Deprecated

- **`THIRD_EYE_INGEST_INTERVAL_MIN` env var** and the OS-scheduler
  scripts (`npm run schedule:install` / `:status` / `:uninstall`).
  Both keep working unchanged through the 2.x line and will be
  **removed in 3.0**. Migrate to **Settings → Auto-refresh** in
  the dashboard, or `PATCH /api/settings { ingest: { enabled:
  true, intervalSeconds: 900 } }` for headless provisioning. The
  server logs a one-shot deprecation warning at boot when the env
  var is set, so operators see the notice in their container logs.

### Fixed

- **Three hardcoded aria-labels translated.** "prev" / "next" on
  the date-picker month navigator and "Add widget to empty slot"
  in the customize grid were shipping in English regardless of
  locale — screen-reader users on non-English builds heard the
  English literals. Audit pass found these by grepping aria-label
  patterns without a t() call. Brand strings (Logo, the Third Eye
  H1) intentionally left as-is.

## [2.5.0] — 2026-05-03

The Codex release. First-class telemetry for OpenAI's Codex /
ChatGPT plan, end-to-end: every JSONL session is now correctly
parsed (originator-case, turn_context model swaps, Codex Desktop),
the dual-window rate-limit payload (5h primary + 7d secondary)
turns into a daily KPI on the Today view and a stacked per-day
history chart on the dashboard, and the binding "limit reached"
signal — Plus/Pro credits exhaustion — is surfaced as its own
metric distinct from the percentage windows. Also: dashboard
filters now persist in the URL, so refresh/back/share-link work.

### Added

- **Codex plan KPI (Today view).** Three-panel widget — plan
  type, peak 5h-window utilization for the day, and Plus/Pro
  credits state — composed from the day's `rate_limits` samples.
  Sizes 1×1 / 2×1 / 3×1; the value column stays short ("0", "∞",
  the balance number) so 1×1 fits cleanly while the descriptive
  word ("exhausted", "unlimited") drops to the sub-line. The
  reset-countdown ("resets in 4h") is hidden on past-day views
  where the window has long since cycled.
- **Codex plan history chart (Dashboard).** Stacked bars per day,
  one colored segment per `plan_type` active that day (free /
  plus / pro / go / enterprise), height = peak primary % during
  that plan. The 7d secondary window overlays as a dashed line
  on top — slow-moving cumulative weekly cap, distinct from the
  per-day spikes the bars show. Visible Legend, gap-honoring
  (idle days break the line instead of dragging to zero), bucket
  granularity tracks the dashboard control bar (day/week/month).
- **Per-day Codex plan storage.** New `codex_plan_daily` table
  with per-plan peaks, full snapshot, and `by_plan_json` for the
  stacked breakdown. Rebuilt every ingest; cheap for realistic
  Codex usage.
- **`screens` field on `WidgetDef`.** Declarative whitelist of
  surfaces a widget can appear on (`'dashboard' | 'project' |
  'today'`). Replaces the ad-hoc `if (inProjectView) …` gating
  scattered across the widget registry. Catalog filters in one
  place; saved layouts referencing screen-incompatible widgets
  get scrubbed automatically.
- **URL-persisted dashboard filters.** Date range, granularity
  and provider chips now live in the hash query
  (`#/?from=…&to=…&g=week&p=codex`, same shape on
  `#/project/<id>`). Refresh, back-forward and shared links all
  preserve the view. Default-preset values are dropped from the
  URL so a user on defaults still sees a clean `#/`.

### Changed

- **Codex `cache_write` honestly null when unavailable.** OpenAI
  rolls cache-write into `input_tokens` rather than reporting it
  separately, so a Codex-only scope that previously displayed
  "0 tokens cached" now shows "—" with a tooltip explaining
  why. Mixed scopes (Claude + Codex) keep the real number from
  the Claude side.
- **Codex `rate_limit_reached` derived from `credits.has_credits`.**
  The documented `rate_limit_reached_type` field turns out to be
  rarely populated in practice; the binding signal on paid plans
  is `credits.has_credits === false`. The KPI's red "Limit
  reached" accent now triggers on the actual signal CLI uses.
- **Default Today granularity for the Codex plan KPI.** Past-day
  views (`/day/2026-04-06`) read from the daily aggregate, not
  the latest snapshot — navigating back through history shows
  each day's actual peak, not today's number applied to
  yesterday's date.

### Fixed

- **Codex Desktop sessions ingested.** The originator field
  ships as `"Codex Desktop"` (capital C) in the desktop client
  while CLI uses `"codex"`; the originator check is now
  case-insensitive, so Desktop sessions land in the dashboard
  alongside CLI ones.
- **All Codex calls no longer collapse to "GPT-5".** The model
  string lives in `turn_context` events, not `session_meta`,
  on newer Codex versions. We now track turn_context updates
  through the session and re-resolve the model on every call.
- **Stale model column on re-ingest.** `model=excluded.model`
  was missing from the `api_calls` upsert SET clause, so a
  re-ingest after a model change kept the old name. Fixed.
- **Codex pricing cache moved off `~/.cache/codeburn`.** Stale
  pre-rename location lingered after the CodeBurn → Third Eye
  migration. Now writes to `~/.cache/third-eye`.

## [2.4.0] — 2026-05-02

The agent telemetry release. Surfacing what your AI subagents
actually do — across any project, regardless of how you use Claude
Code (frontend dev, NPC simulation, parallel research, anything).
Driven by a real-world test on a 32-NPC D&D-village simulation
that exposed roughly a year of hidden bugs in the parser and a
handful of UX papercuts.

### Added

- **`agentType` is now the canonical role source.** Claude Code
  2.x writes a sibling `agent-<id>.meta.json` next to every
  subagent transcript with an explicit `agentType` field. We
  used to ignore it and rely on a heuristic "<role>:" prefix
  in description, which only ~10% of files happen to follow.
  Result before: hundreds of agents stuck in "unknown". Result
  after: full classification end-to-end with no user action.
- **Parser captures `prompt_id` and `stop_reason`** per agent
  session. Drives spawn-batch grouping and (future) failure
  detection.
- **Tools-by-role widget** — heatmap matrix where rows are
  configured roles, columns are top tools, cells show what each
  role spends its tool calls on. Answers "when my <role>
  agents run, what work do they actually do?".
- **Parallel spawn-batches widget** — log of orchestration calls
  where Claude dispatched multiple subagents at once
  (Plan-mode rollouts, parallel research, simulation ticks).
  Sorted newest-first; size column shows the fan-out width.
- **Setup banner re-triggers when new roles appear.** Used to
  retire permanently after first configuration; now reappears
  whenever a fresh agent role lands without a registry row,
  with copy that distinguishes "set things up the first time"
  from "new roles since last setup".
- **Refresh in the header now invalidates agent + project +
  insights caches**, not just providers/overview. New agents
  spawned between two refreshes used to remain invisible in
  Manage Agents until a full page reload.
- **`THIRD_EYE_CLAUDE_DIR` env var** for non-default Claude
  Code install locations (multi-user servers, Docker mounts,
  symlinks, NAS-backed storage). Priority over Claude Code's
  own `CLAUDE_CONFIG_DIR`. Documented in DOCS.md "Custom
  Claude Code location".
- **Vitest test suite + GitHub Actions CI.** First test
  infrastructure for the project — 30 tests across parser,
  path resolution, semver. Synthetic JSONL fixtures cover the
  branches we care about (with/without meta.json, corrupt
  meta, validity gate, etc.). Suite runs in ~250 ms; CI blocks
  merge on failure.

### Changed

- **Aggregate agent KPIs use unfiltered totals.** The
  registry-filtered totals previously used by Agent Efficiency,
  Agent Sessions, and Agent Session Avg were silently lying
  when the user hadn't classified some roles. Aggregates now
  show the truth across ALL subagent activity; the registry
  continues to drive per-role breakdowns (byRole, topSessions,
  timeline, toolSpectrum, spawnBatches) where naming and
  grouping is the actual point.
- **Default project layout includes the new agent widgets**
  (tool-spectrum, spawn-batches) at y=26. Existing layouts
  unchanged; new users see the full v2.4 view out of the box.

### Removed

- **Legacy `subagents` insights widget.** It was a thin counter
  on `tool_events.kind='subagent'` (Task tool dispatch events)
  with cost-of-the-call-not-the-agent. Superseded by
  `agent-distribution`, which reads from the proper
  `agent_sessions` table with full per-agent decomposition.
  Kept the `tool_events.kind='subagent'` rows in the DB for
  anyone querying directly; just dropped the widget.

### Fixed

- **Database auto-detect prefers data over filename.** Affects
  the upgrade path from the CodeBurn fork only: if both
  `third-eye.db` and `codeburn.db` exist in `server/data/`,
  the one with actual data wins. Previously a 0-byte
  `third-eye.db` placeholder (which can be created by certain
  install paths on a fresh data volume) silently shadowed a
  populated legacy file. New installs untouched.
- **Cross-platform path centralization.** Two duplicated
  `getClaudeDir()` helpers collapsed into one
  `server/lib/claude-paths.ts`. The macOS-hardcoded path in
  ingest's Cowork resolver now uses the per-OS dispatcher.
  Audit pass confirmed all path concatenations use
  `path.join` and all home-directory references go through
  `os.homedir()` (no shell-style `~` strings).
- **Per-file try/catch** around `parseAgentFile` in the agent
  scanner. A single corrupt JSONL or unreadable file used to
  abort the whole agent ingest; now it logs and continues.
- **MidEllipsis no longer collapses short labels to a lone "…"**
  on first paint. Web fonts load async; the first measurement
  often used wrong fallback metrics and over-truncated. Added
  re-measure after `document.fonts.ready` plus a `MIN_VISIBLE`
  floor that bails to full text if truncation would clip below
  three characters.
- **MidEllipsis oscillation loop on the project header**
  fixed. Renaming a project to its auto-derived label could
  cause the title to "breathe" — collapsing and expanding
  forever, freezing the JS thread. Two fixes: `align-self:
  stretch` on the title so its width no longer depends on its
  own children, and an in-component oscillation guard that
  freezes after detecting a repeating truncation candidate.
- **Migration order guard.** `addCol()` now silently skips
  ALTER on missing tables instead of aborting the entire
  migration on a fresh DB (caught during a v2.4 Docker smoke
  run when a `prompt_id` ALTER landed above its `CREATE
  TABLE`).

### Internal

- ROADMAP captures the v2.4.1 (robustness) and v2.5.0 (scale)
  next steps so they survive across sessions: incremental
  agent ingest by mtime, failure-detection widget on top of
  the new `stop_reason`.

## [2.3.0] — 2026-04-27

### Added
- **"New version available" awareness in the header.** The server
  polls the GitHub Releases API on its own schedule (default once
  per hour, never more often than once per hour in production) and
  the client surfaces three states next to the version badge:
  - tiny green dot — running latest, with a "last checked X" tooltip;
  - tiny spinner — a check is in flight;
  - orange "↑ New version available" pill — opens a modal with
    copy-paste install commands for Docker and Node, plus a link
    to the GitHub release notes.
  All three are localized in en/ru/es/de/zh.
- **Settings modal.** A gear icon next to the theme toggle opens a
  settings dialog. Currently hosts the *Updates* section (master
  toggle + frequency dropdown). Section/grid scaffolding is ready
  for future settings groups. Custom-styled toggle switch and
  dropdown so the form matches the rest of the dashboard's look,
  not 2003 browser defaults.
- **Multi-tab coordination.** When the dashboard is open in more
  than one tab, exactly ONE of them polls `/api/version` — it
  holds a Web Lock and broadcasts each result over a
  `BroadcastChannel` so follower tabs stay in sync without making
  their own requests. When the leader tab closes the lock auto-
  releases and one of the waiting tabs gets promoted.
- **`THIRD_EYE_GITHUB_REPO` env var** to override the default
  `fien-atone/third-eye` repository (forks / private mirrors).
  GitHub auth tokens are intentionally NOT supported — the
  dashboard ships to end users and an embedded shared token would
  leak across installs.

### Changed
- **Header layout: data freshness moves right, version freshness
  stays left.** The "Last refresh: Xm ago" indicator (data-ingest
  freshness) now sits next to the Refresh button on the right of
  the header, instead of floating in the brand cluster on the
  left. Version freshness (the dot / spinner / pill described
  above) stays adjacent to the version badge. Two domains, two
  locations — no more "is this about app version or about data?"
  confusion.
- **Single source of truth for "current version".** The client's
  build-time `__APP_VERSION__` is now the only thing used to
  decide whether the running bundle is up to date — the server no
  longer reports a `current` field. Eliminates a class of dev-mode
  skew where the server and Vite could disagree about what version
  was running.

### Fixed
- **Recharts `width(-1)`/`height(-1)` console warnings** silenced by
  passing `minWidth={0} minHeight={0}` on every `ResponsiveContainer`.
  These fired on every page load because GridStack sizes its tiles
  after children mount; the noisy warning had nothing to do with
  the actual chart but drowned out real errors during debugging.

### Internal
- **Defensive interval clamp on read.** Settings rows storing
  `intervalSeconds` are clamped to the production floor (1 h) on
  read, not just on write, so a `data/third-eye.db` that was
  configured in dev with a 30-second cadence can't burn the GitHub
  rate limit when shipped inside a production Docker image.

## [2.2.2] — 2026-04-27

### Fixed
- **Project page header overflowed on long auto-labels** (raw
  filesystem paths from Cowork ephemeral sessions). Title now
  flex-shrinks and uses `MidEllipsis` so the rename button never gets
  pushed off the right edge.
- **Top file hotspots widget leaked a thin strip** below each row
  from a hidden `.file-full` overlay that was clipped by the cell's
  `overflow: hidden`. Removed the custom overlay; the native `title`
  tooltip already handled full-path disclosure cross-browser.

### Added
- **Favorite toggle on the project page header** — a star button next
  to the title pins/unpins the project, mirroring the toggle in the
  projects list. Reuses the existing `PATCH /api/projects/:id { favorite }`
  endpoint.

## [2.2.1] — 2026-04-27

### Fixed
- **`docker compose up --build` failed at `npm ci`** ([#2]) due to stale
  per-package `client/package-lock.json` and `server/package-lock.json`
  that drifted out of sync with the authoritative root lockfile after
  workspaces deps were added (e.g. `gridstack`). The Dockerfile now
  installs from the root via `npm ci -w <workspace>`, the per-package
  lockfiles are gone from the repo, and `.gitignore` blocks them so
  they can't be reintroduced by accident. Local `npm install` and
  `npm run dev` are unaffected — they were already using the root
  lockfile via npm workspaces; the per-package files were dead weight.

### Added
- **Release checklist** in `DOCS.md` for maintainers — explicit Docker
  build + run + health-check step, so future releases can't ship with
  a broken container the way v2.2.0 did.

[#2]: https://github.com/fien-atone/third-eye/issues/2

## [2.2.0] — 2026-04-24

### Changed
- **Env-var namespace renamed** from `CODEBURN_*` (legacy from the
  CodeBurn fork) to `THIRD_EYE_*`. All call-sites, `docker-compose.yml`,
  `Dockerfile`, and `DOCS.md` now use the new prefix. Old names still
  read silently as a fallback via `server/lib/env.ts` — existing
  deployments continue to work with no action required. The default
  SQLite filename is now `third-eye.db`; an existing `codeburn.db` in
  `server/data/` is auto-discovered and kept in place.
- **Planned for v3.0**: drop the `CODEBURN_*` legacy fallback and the
  `codeburn.db` filename autodetect. A single CHANGELOG note will
  announce the breaking change; users on the default docker-compose
  or Dockerfile will have migrated naturally by then.

## [2.1.1] — 2026-04-24

### Fixed
- **GitHub couldn't detect the MIT license** — an extra attribution
  paragraph at the bottom of `LICENSE` made GitHub's `licensee`
  classifier flag the file as `NOASSERTION` ("Other"), so the
  repo's sidebar showed no license badge. The paragraph moved into
  a new `## Acknowledgements` section in README.md that links to
  the already-existing `THIRD_PARTY_NOTICES.md`. `LICENSE` now
  matches the canonical MIT template verbatim.

## [2.1.0] — 2026-04-24

### Added
- **"Today" tab** with hour-by-hour breakdown of a single calendar
  day (00:00–23:59 in your local timezone, not a rolling 24-hour
  window). Date picker + ◀ / Today / ▶ shortcuts in the header,
  URL deep-linking via `#/today` and `#/day/YYYY-MM-DD`.
- **Hour granularity** added to `/api/overview` (`granularity=hour`).
  Bucket key is `YYYY-MM-DD HH:00` so multi-day hour ranges don't
  collapse same-hour bars across days.
- **Five new day-view widgets**, all customizable like every other
  widget:
  - `hour-timeline` — 24 bars of cost across the selected day.
  - `hours-heatstrip` — single-row 24-cell strip of color intensity.
  - `days-hours-heatmap` — 30 days × 24 hours grid with click-a-day
    navigation.
  - `days-hours-heatmap-week` — 7-day variant of the above for a
    tighter focus on the recent week.
  - `weekday-hour-heatmap` — 7×24 day-of-week × hour pattern over
    the last 90 days, for "when do I usually work" patterns.
- **Customize toolbar** in the Day-view header (drag/resize widgets,
  Reset to defaults, Cancel, Save) — same pattern as the home
  dashboard and project pages.
- **CI build check** (`.github/workflows/build.yml`) — runs
  `npm run build` on every push and PR. v2.0.0 shipped with TS
  errors that blocked `npm start` for fresh installers; this
  workflow exists so that doesn't happen again.

### Changed
- **`kpi-scope` widget** now shows `Active hours` on the day-view
  (was falling back to `Active months` because the widget didn't
  know about the `hour` granularity).
- **Per-granularity panel subtitles** for `cost-by-project`,
  `cost-by-model`, and `calls` widgets gained `subHour` variants
  in all 5 locales — previously fell through to the monthly fallback
  when used on the day-view.
- **Hover ring on heatmap cells** moved to `outline-offset: -2px`
  (inset) — the previous outset 2px ring got clipped by the panel's
  `overflow:hidden` boundary on edge cells.
- **Bottom-row "+" slot** on every dashboard now accepts widgets of
  any height (was h≤1 only, hiding most chart widgets from the
  picker). Visual placeholder stays one cell tall; the picker
  treats the slot as height-unbounded.
- **Picker preview** for the bottomless slot anchors the highlight
  to the bottom of the mini-grid instead of trying to draw at
  y=10+ where nothing is visible.
- **Project rename** — the pencil now sits next to the H1 title
  on the project page (was only on the projects list page).
- **CSS split into per-feature files** under `client/src/styles/`
  — index.css went from 2948 lines to 17 (just `@import` entries).
  Dropped 19 dead classes left over from earlier iterations.
- **App.tsx slimmed from 673 to 283 lines** by extracting:
  - `screens/project-page.tsx` (project header + insights query)
  - `components/{app-header,dashboard-controls,date-field,
    locale-switcher,theme-toggle,footer,server-down-banner}.tsx`
  - `lib/use-fit-count.ts` was already extracted in 2.0.

### Fixed
- **Reset to defaults on /today** now actually resets the today
  layout — previously `editScreen` only knew about `dashboard` and
  `project`, so Reset on /today silently wiped the home dashboard
  layout instead.
- **Widget customize toolbar visible on /today** — the day-view
  used a custom header that didn't render the standard controls
  bar, so there was no Customize button at all.
- **`hours-heatstrip` cells fixed-height (28px)** caused clipping
  on narrow tiles — now flex-stretch with `min-height: 12px` and
  `max-height: 64px`.
- **Days × hours weekly heatmap** date labels now align in
  columns (day-num right-aligned in 12px slot, month left-aligned
  in 22px slot, `tabular-nums`) — previously day numbers wandered
  horizontally based on digit count.
- **Days × hours heatmap row order** flipped to newest-first
  (selected day on top, older below) to match how people read
  date timelines.

## [2.0.1] — 2026-04-24

### Fixed
- **Production build failed** with three TS6133 errors in
  `client/src/widgets/panels.tsx` (unused `fmt`, `total`, `sorted`,
  `pieData` locals left behind by the v2.0.0 VersionsPanel refactor).
  Fresh installs of v2.0.0 hitting `npm start` (which builds the
  client) couldn't get past `tsc -b`. Removed the dead bindings and
  fixed the related `metricLabel` so the column header tracks the
  effective metric instead of the un-clamped one (visible only when
  the filter chips are hidden on a narrow Versions tile).

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
