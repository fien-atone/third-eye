# Roadmap

What's coming to Third Eye and why. Living document — priorities shift
based on user feedback. Past releases are in [CHANGELOG.md](./CHANGELOG.md).

## Now (active work)

Nothing actively in flight — v1.4.0 just shipped. We're listening for
feedback from the first wave of users on widget layouts before picking
the next focus area.

## Next (likely v1.5.x)

These are the next things on the queue. Order will depend on what users
hit first.

- **Settings screen** — central place for things that currently live in
  the header (theme, locale) plus new controls (data location, ingest
  schedule, export). Also gets the widget grid like Dashboard / Project.
- **Keyboard accessibility for widget drag** — arrow-key reposition,
  enter/space to grab, escape to cancel. Currently widgets are
  drag-only (mouse). Screen-reader announcements via aria-live.
- **Touch-drag editing on tablets** — currently edit mode is disabled
  below 720px to avoid the touch-vs-scroll ambiguity. Solution likely
  involves a long-press to enter "lift" state, then drag. Worth a
  spike before committing.
- **Per-breakpoint layouts** — right now mobile renders the desktop
  layout in y-order as a single column. Some widgets (e.g. Project
  activity) don't read well at 320px width. Allow users to define a
  separate "phone" layout, or smart-collapse multi-column widgets.

## Mid-term (likely v2.0)

Bigger architectural shifts. Each is a major version on its own merit.

- **react-grid-layout v1.5.3 → v2.x migration** — v2 was a complete API
  rewrite released in December 2025 (4 days after the last v1 patch).
  v1 still works fine and is patched, but v2 has nicer hooks-based
  internals. Wait ~6-12 months after v2 release for the ecosystem to
  catch up (plugins, examples, edge-case fixes), then migrate. See the
  v1.4.0 commit message for the full v1-vs-v2 rationale.
- **Rename SQLite file `codeburn.db` → `third-eye.db`** — legacy from
  vendoring CodeBurn's parser. Cosmetic but the current name confuses
  new users ("what's CodeBurn? is it spying on me?"). Needs a one-off
  migration that copies the file then updates `DB_PATH`. Coordinate
  with users — they need to back up first.
- **Multi-tenant mode** — Third Eye is currently single-user (whoever
  has access to the local SQLite file sees everything). Some teams
  want a hosted instance shared across the team with per-user views
  on the same data. Adds auth, per-user layouts, per-user labels.

## Considered (might or might not happen)

Ideas worth thinking about but not committed to. Open to PRs and
discussion in issues.

- **Anthropic rate-limit data ingest** — we currently parse session
  files on disk. Anthropic also exposes per-account rate-limit /
  usage telemetry via an authenticated endpoint that the JSONL files
  don't capture (it's blocked by the HTTP client before logging).
  Three approaches sketched; none picked yet:
  - (a) Cookie-based polling of `claude.ai/api` — fragile, breaks on
    auth changes
  - (b) Auto-extract from Claude Desktop's own state — tied to
    desktop app version
  - (c) Browser extension companion — clean but big surface to maintain
- **CSV / JSON export** — for accountants, expense reports, or piping
  into other tooling. Trivial to add but no-one's asked yet.
- **Cost forecast** — extrapolate current month's spend based on
  trajectory so far. Useful for budget planning. Trick is making the
  forecast honest about uncertainty (a single bad day shouldn't make
  it predict 10× the budget).
- **Per-widget options menu** — some widgets have implicit options
  (Versions panel toggle between cost/calls/tokens, Models panel
  sorting, etc.) that today live inside the widget. Could promote to
  a small ⚙ in the widget's edit-mode handle so users find them.

## Out of scope (decisions to not do)

For posterity — things we considered and explicitly decided against,
so the conversation doesn't keep coming up.

- **Replace SQLite with Postgres** — Third Eye is a personal tool, you
  run it yourself, your data is one file. Postgres would mean a
  service to run, backup, monitor. SQLite stays.
- **Cloud-hosted SaaS version** — privacy is a feature, not a bug.
  Your AI-coding-spend data stays on your machine. If a team hosts a
  shared instance internally, that's still self-hosted.
- **Subscription / paywall** — Third Eye is MIT-licensed and free.
  That's not changing.
- **Real-time updates via WebSocket** — overhead not worth it for
  data that updates every few minutes. Manual refresh + scheduled
  ingest is enough.

---

If something here lights up for you — or if there's something you wish
existed that isn't listed — open an issue on GitHub.
