/**
 * Default screen layouts. Seeded into the DB on first startup; never
 * applied retroactively over a user's customizations. Each entry maps a
 * widget id (defined in the client's catalog) to its initial position
 * and size in a 12-column grid.
 *
 * Layout coords: x and w in 12 column units (0..11); y and h in row
 * units (~60px each). minW/minH are enforced by react-grid-layout to
 * prevent the user from shrinking a widget below readable size.
 *
 * Seeding rule: INSERT OR IGNORE — if a row exists for a screen, the
 * default is left alone, so users keep their customizations across
 * upgrades. New widgets added in later releases are NOT auto-injected
 * into existing layouts (the user adds them via the "+" picker).
 */

export type Placed = {
  i: string         // widget id (matches the client catalog key)
  x: number; y: number
  w: number; h: number
  minW?: number; minH?: number
}

export type ScreenLayout = {
  widgets: Placed[]   // widgets currently placed on screen
  hidden: string[]    // widgets not on screen but still in catalog
}

/** 12-column grid. Top row is KPI groups (w=3 each → 4 across).
 *  Then the big charts stack full-width, ending with a 2-up row. */
export const DASHBOARD_DEFAULT: ScreenLayout = {
  widgets: [
    // Row 0 — KPI groups (4 across)
    { i: 'kpi-spend',  x: 0, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
    { i: 'kpi-tokens', x: 3, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
    { i: 'kpi-cache',  x: 6, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
    { i: 'kpi-scope',  x: 9, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
    // Stacked-bars area — full width
    { i: 'cost-by-project', x: 0, y: 2,  w: 12, h: 7, minW: 6, minH: 5 },
    { i: 'cost-by-model',   x: 0, y: 9,  w: 12, h: 6, minW: 6, minH: 5 },
    { i: 'tokens',          x: 0, y: 15, w: 12, h: 6, minW: 6, minH: 5 },
    { i: 'calls',           x: 0, y: 21, w: 12, h: 4, minW: 6, minH: 4 },
    { i: 'models',          x: 0, y: 25, w: 12, h: 7, minW: 6, minH: 5 },
    // Bottom row — two-up
    { i: 'activity',     x: 0, y: 32, w: 6, h: 6, minW: 4, minH: 4 },
    { i: 'top-projects', x: 6, y: 32, w: 6, h: 6, minW: 4, minH: 4 },
  ],
  hidden: [],
}

/** Project view: same KPI + charts at top (scoped to single project),
 *  then insights panels in a 3-up grid, plus the activity heatmap. */
export const PROJECT_DEFAULT: ScreenLayout = {
  widgets: [
    // Row 0 — KPI groups (no `kpi-scope` here: irrelevant for single project)
    { i: 'kpi-spend',  x: 0, y: 0, w: 4, h: 2, minW: 2, minH: 2 },
    { i: 'kpi-tokens', x: 4, y: 0, w: 4, h: 2, minW: 2, minH: 2 },
    { i: 'kpi-cache',  x: 8, y: 0, w: 4, h: 2, minW: 2, minH: 2 },
    // Charts
    { i: 'cost-by-model', x: 0, y: 2,  w: 12, h: 6, minW: 6, minH: 5 },
    { i: 'tokens',        x: 0, y: 8,  w: 12, h: 6, minW: 6, minH: 5 },
    { i: 'calls',         x: 0, y: 14, w: 12, h: 4, minW: 6, minH: 4 },
    { i: 'models',        x: 0, y: 18, w: 12, h: 7, minW: 6, minH: 5 },
    // Insights — 3-up
    { i: 'activity',  x: 0, y: 25, w: 6, h: 6, minW: 4, minH: 4 },
    { i: 'subagents', x: 6, y: 25, w: 6, h: 6, minW: 4, minH: 4 },
    { i: 'skills',    x: 0, y: 31, w: 4, h: 5, minW: 3, minH: 4 },
    { i: 'mcp',       x: 4, y: 31, w: 4, h: 5, minW: 3, minH: 4 },
    { i: 'bash',      x: 8, y: 31, w: 4, h: 5, minW: 3, minH: 4 },
    { i: 'files',     x: 0, y: 36, w: 8, h: 6, minW: 4, minH: 5 },
    { i: 'flags',     x: 8, y: 36, w: 4, h: 6, minW: 3, minH: 4 },
    { i: 'versions',  x: 0, y: 42, w: 12, h: 6, minW: 6, minH: 5 },
    { i: 'branches',  x: 0, y: 48, w: 6, h: 5, minW: 4, minH: 4 },
    { i: 'heatmap',   x: 0, y: 53, w: 12, h: 5, minW: 6, minH: 4 },
  ],
  hidden: [],
}

export const DEFAULT_LAYOUTS: Record<string, ScreenLayout> = {
  dashboard: DASHBOARD_DEFAULT,
  project: PROJECT_DEFAULT,
}

export const KNOWN_SCREENS = new Set(Object.keys(DEFAULT_LAYOUTS))
