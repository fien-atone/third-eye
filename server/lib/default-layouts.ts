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
    { i: 'activity',     x: 0, y: 12, w: 2, h: 2, minW: 2, minH: 2 },
    { i: 'top-projects', x: 2, y: 12, w: 2, h: 2, minW: 2, minH: 2 },
  ],
  hidden: [],
}

export const PROJECT_DEFAULT: ScreenLayout = {
  widgets: [
    // Row 0 — KPI groups (4 across)
    { i: 'kpi-spend',  x: 0, y: 0, w: 1, h: 1, minW: 1, minH: 1 },
    { i: 'kpi-tokens', x: 1, y: 0, w: 1, h: 1, minW: 1, minH: 1 },
    { i: 'kpi-cache',  x: 2, y: 0, w: 1, h: 1, minW: 1, minH: 1 },
    { i: 'kpi-scope',  x: 3, y: 0, w: 1, h: 1, minW: 1, minH: 1 },
    // Charts full-width
    { i: 'cost-by-model', x: 0, y: 1, w: 4, h: 2, minW: 2, minH: 2 },
    { i: 'tokens',        x: 0, y: 3, w: 4, h: 2, minW: 2, minH: 2 },
    { i: 'calls',         x: 0, y: 5, w: 4, h: 2, minW: 2, minH: 2 },
    { i: 'models',        x: 0, y: 7, w: 4, h: 2, minW: 2, minH: 2 },
    // Insights — 2-up pairs
    { i: 'activity',  x: 0, y: 9, w: 2, h: 2, minW: 2, minH: 2 },
    { i: 'subagents', x: 2, y: 9, w: 2, h: 2, minW: 2, minH: 2 },
    { i: 'skills',    x: 0, y: 11, w: 2, h: 2, minW: 2, minH: 2 },
    { i: 'mcp',       x: 2, y: 11, w: 2, h: 2, minW: 2, minH: 2 },
    { i: 'bash',      x: 0, y: 13, w: 2, h: 2, minW: 2, minH: 2 },
    { i: 'flags',     x: 2, y: 13, w: 2, h: 2, minW: 2, minH: 2 },
    { i: 'files',     x: 0, y: 15, w: 4, h: 2, minW: 2, minH: 2 },
    { i: 'versions',  x: 0, y: 17, w: 4, h: 2, minW: 2, minH: 2 },
    { i: 'branches',  x: 0, y: 19, w: 2, h: 2, minW: 2, minH: 2 },
    { i: 'heatmap',   x: 2, y: 19, w: 2, h: 2, minW: 2, minH: 2 },
  ],
  hidden: [],
}

export const DEFAULT_LAYOUTS: Record<string, ScreenLayout> = {
  dashboard: DASHBOARD_DEFAULT,
  project: PROJECT_DEFAULT,
}

export const KNOWN_SCREENS = new Set(Object.keys(DEFAULT_LAYOUTS))
