/**
 * Default screen layouts — seeded once into `screen_layouts` on first
 * startup; never overwritten afterward.
 *
 * GRID SYSTEM: 4 columns × 132px row units (CELL_HEIGHT in client).
 *   - KPI widgets: w=1  h=1 (¼ width, 132px tall)
 *   - Half charts: w=2  h=2 (½ width, 276px = 2 KPIs stacked)
 *   - Full charts: w=4  h=2 (full width)
 *   - Tall content (chart with legend, tables, heatmap): w=4 h=3 (420px)
 *
 * UNIT INVARIANT: every widget height is an integer number of units.
 *   2 KPIs stacked (h=1 + 12 margin + h=1) = h=2 chart exactly.
 *   3 KPIs stacked = h=3 tall chart exactly.
 * Resize steps are 1 unit at a time — no half-units possible.
 */

export type Placed = {
  i: string
  x: number; y: number
  w: number; h: number
  minW?: number; minH?: number
}

export type ScreenLayout = {
  widgets: Placed[]
  hidden: string[]
}

export const DASHBOARD_DEFAULT: ScreenLayout = {
  widgets: [
    // Row 0 — KPI groups (4 across, h=1 each)
    { i: 'kpi-spend',  x: 0, y: 0, w: 1, h: 1, minW: 1, minH: 1 },
    { i: 'kpi-tokens', x: 1, y: 0, w: 1, h: 1, minW: 1, minH: 1 },
    { i: 'kpi-cache',  x: 2, y: 0, w: 1, h: 1, minW: 1, minH: 1 },
    { i: 'kpi-scope',  x: 3, y: 0, w: 1, h: 1, minW: 1, minH: 1 },
    // Charts stacked full-width (h=2 standard, h=3 if needs legend room)
    { i: 'cost-by-project', x: 0, y: 1, w: 4, h: 3, minW: 2, minH: 3 },
    { i: 'cost-by-model',   x: 0, y: 4, w: 4, h: 2, minW: 2, minH: 2 },
    { i: 'tokens',          x: 0, y: 6, w: 4, h: 2, minW: 2, minH: 2 },
    { i: 'calls',           x: 0, y: 8, w: 4, h: 2, minW: 2, minH: 2 },
    { i: 'models',          x: 0, y: 10, w: 4, h: 3, minW: 2, minH: 2 },
    // Bottom row — two-up
    { i: 'activity',     x: 0, y: 13, w: 2, h: 2, minW: 2, minH: 2 },
    { i: 'top-projects', x: 2, y: 13, w: 2, h: 2, minW: 2, minH: 2 },
  ],
  hidden: [],
}

export const PROJECT_DEFAULT: ScreenLayout = {
  widgets: [
    // KPI pins row
    { i: 'kpi-spend',  x: 0, y: 0, w: 1, h: 1 },
    { i: 'kpi-tokens', x: 1, y: 0, w: 1, h: 1 },
    { i: 'kpi-cache',  x: 2, y: 0, w: 1, h: 1 },
    { i: 'kpi-scope',  x: 3, y: 0, w: 1, h: 1 },
    // Full-width charts
    { i: 'cost-by-model', x: 0, y: 1, w: 4, h: 3 },
    { i: 'tokens',        x: 0, y: 4, w: 4, h: 3 },
    { i: 'calls',         x: 0, y: 7, w: 4, h: 2 },
    { i: 'models',        x: 0, y: 9, w: 4, h: 2 },
    // Insights — two-up pairs
    { i: 'activity',  x: 0, y: 11, w: 2, h: 2 },
    { i: 'mcp',       x: 2, y: 11, w: 2, h: 2 },
    { i: 'versions',  x: 0, y: 13, w: 2, h: 2 },
    { i: 'skills',    x: 2, y: 13, w: 2, h: 2 },
    { i: 'bash',      x: 0, y: 15, w: 2, h: 2 },
    { i: 'branches',  x: 2, y: 15, w: 2, h: 2 },
    { i: 'files',     x: 0, y: 17, w: 4, h: 2 },
    // Agents block: KPI pins → tables side-by-side → timeline
    { i: 'kpi-agent-delegation',         x: 0, y: 19, w: 1, h: 1 },
    { i: 'kpi-agent-sessions',           x: 1, y: 19, w: 1, h: 1 },
    { i: 'kpi-agent-tokens-per-session', x: 2, y: 19, w: 1, h: 1 },
    { i: 'agent-distribution', x: 0, y: 20, w: 2, h: 3 },
    { i: 'agent-top-sessions', x: 2, y: 20, w: 2, h: 3 },
    { i: 'agent-timeline',     x: 0, y: 23, w: 4, h: 3 },
  ],
  hidden: ['subagents', 'flags'],
}

/** Day-view screen — single calendar day, hour-by-hour breakdown.
 *  Hour-timeline replaces the daily charts (cost-by-* / tokens /
 *  calls / activity); KPIs and top-projects stay because they make
 *  sense scoped to a day too. */
export const TODAY_DEFAULT: ScreenLayout = {
  widgets: [
    // Hours strip on top — quickest "when did anything happen today" read.
    { i: 'hours-heatstrip',         x: 0, y: 0, w: 4, h: 1, minW: 2, minH: 1 },
    // KPIs row.
    { i: 'kpi-spend',  x: 0, y: 1, w: 1, h: 1, minW: 1, minH: 1 },
    { i: 'kpi-tokens', x: 1, y: 1, w: 1, h: 1, minW: 1, minH: 1 },
    { i: 'kpi-cache',  x: 2, y: 1, w: 1, h: 1, minW: 1, minH: 1 },
    { i: 'kpi-scope',  x: 3, y: 1, w: 1, h: 1, minW: 1, minH: 1 },
    // Last week × hours next to models for context.
    { i: 'days-hours-heatmap-week', x: 0, y: 2, w: 2, h: 2, minW: 2, minH: 2 },
    { i: 'models',                  x: 2, y: 2, w: 2, h: 2, minW: 2, minH: 2 },
    // Cost charts side-by-side.
    { i: 'cost-by-project', x: 0, y: 4, w: 2, h: 3, minW: 2, minH: 3 },
    { i: 'cost-by-model',   x: 2, y: 4, w: 2, h: 3, minW: 2, minH: 2 },
    // Bottom row — top-projects + calls.
    { i: 'top-projects', x: 0, y: 7, w: 2, h: 2, minW: 2, minH: 2 },
    { i: 'calls',        x: 2, y: 7, w: 2, h: 2, minW: 2, minH: 2 },
    // Activity full-width below.
    { i: 'activity',     x: 0, y: 9, w: 2, h: 2, minW: 2, minH: 2 },
  ],
  // Available via the picker but not in the default layout.
  hidden: ['hour-timeline', 'tokens', 'days-hours-heatmap', 'weekday-hour-heatmap'],
}

export const DEFAULT_LAYOUTS: Record<string, ScreenLayout> = {
  dashboard: DASHBOARD_DEFAULT,
  project: PROJECT_DEFAULT,
  today: TODAY_DEFAULT,
}

export const KNOWN_SCREENS = new Set(Object.keys(DEFAULT_LAYOUTS))
