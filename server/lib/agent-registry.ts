/**
 * Per-project agent registry — user-curated list of "what counts as
 * an agent" in a given project. Drives:
 *   - the setup banner (shown while unacknowledged raw roles exist)
 *   - the agent-insights widget (data filtered through the registry;
 *     unregistered or disabled roles roll up into `Unclassified`)
 *
 * Detection semantics:
 *   - Every raw `role` value in `agent_sessions` for a project is a
 *     candidate.
 *   - A candidate is "acknowledged" when it has a row in
 *     `agent_registry` — `enabled=1` means surface as first-class,
 *     `enabled=0` means the user saw it and explicitly hid it.
 *   - `merged_into` aliases a role onto another registered one
 *     (e.g. `frontend` → `frontend-dev`). The alias chain is shallow
 *     — we resolve one level only; circular / chained merges are
 *     prevented at write time.
 *   - Any candidate without a row is "undetected" — counted in the
 *     banner's "N roles to classify" number until the user either
 *     acknowledges or explicitly disables it.
 */

import { db } from '../db.ts'

export type RegistryRow = {
  project: string
  raw_role: string
  display_name: string | null
  enabled: number
  merged_into: string | null
  updated_at: string
}

export type DetectedRole = {
  rawRole: string
  confidence: string        // 'meta' | 'prompt' | 'unknown'
  sessions: number
  tokens: number
  cost: number
  /** True if this raw-role already has an agent_registry entry. */
  registered: boolean
  /** Present when registered. Echoes user intent (enable/rename/merge). */
  displayName: string | null
  enabled: boolean | null
  mergedInto: string | null
}

/** True iff the project has at least one agent_registry row. Drives
 *  the first-time setup banner: once the user has classified ANY role
 *  the banner retires permanently for this project (further "new
 *  unclassified roles" surfacing is handled by a lighter pill
 *  elsewhere — different UX affordance for a different mental state). */
export function isProjectConfigured(project: string): boolean {
  const row = db().prepare(
    'SELECT 1 FROM agent_registry WHERE project = ? LIMIT 1'
  ).get(project) as unknown | undefined
  return !!row
}

/** True iff ANY project across the DB has a registry row. Drives the
 *  global first-time banner on the main dashboard. */
export function isAnyProjectConfigured(): boolean {
  const row = db().prepare('SELECT 1 FROM agent_registry LIMIT 1').get() as unknown | undefined
  return !!row
}

/** Number of distinct projects that have at least one ACTIONABLE
 *  agent role (non-unknown). Drives the "N roles across M projects"
 *  phrasing on the global banner and the projects-page filter. */
export function countProjectsWithActionableRoles(): number {
  const row = db().prepare(`
    SELECT COUNT(DISTINCT project) AS n
    FROM agent_sessions
    WHERE role != 'unknown'
  `).get() as { n: number }
  return row.n ?? 0
}

/** Per-project count of ACTIONABLE agent roles. Returned as a map so
 *  the /api/projects endpoint can attach it to every row in O(N). */
export function agentRolesByProject(): Map<string, number> {
  const rows = db().prepare(`
    SELECT project, COUNT(DISTINCT role) AS n
    FROM agent_sessions
    WHERE role != 'unknown'
    GROUP BY project
  `).all() as Array<{ project: string; n: number }>
  return new Map(rows.map(r => [r.project, r.n]))
}

/** Count of ACTIONABLE raw-roles that exist in agent_sessions but
 *  have no agent_registry row — i.e. "still need classification".
 *  Drives the badge on the setup banner. The pseudo-role `unknown`
 *  is excluded because there's nothing to classify: these sessions
 *  had no role signal and will always be Unclassified regardless of
 *  user action. Surfacing them would make the banner suggest work
 *  the user can't actually do. */
export function countUnclassified(project: string): number {
  const d = db()
  const row = d.prepare(`
    SELECT COUNT(DISTINCT role) AS n
    FROM agent_sessions
    WHERE project = ? AND role != 'unknown' AND role NOT IN (
      SELECT raw_role FROM agent_registry WHERE project = ?
    )
  `).get(project, project) as { n: number }
  return row.n ?? 0
}

/** Same as above but scoped globally (all projects). Used on the main
 *  dashboard banner when the user has no project selected. Also
 *  excludes `unknown` — see countUnclassified for rationale. */
export function countUnclassifiedGlobal(): number {
  const d = db()
  const row = d.prepare(`
    SELECT COUNT(*) AS n FROM (
      SELECT DISTINCT project, role FROM agent_sessions
      WHERE role != 'unknown' AND NOT EXISTS (
        SELECT 1 FROM agent_registry r
        WHERE r.project = agent_sessions.project AND r.raw_role = agent_sessions.role
      )
    )
  `).get() as { n: number }
  return row.n ?? 0
}

/** All detected raw-roles for a project with per-role aggregates and
 *  their current registry state. Sorted by cost DESC so the most
 *  consequential roles surface first in the classification modal. */
export function listDetectedRoles(project: string): DetectedRole[] {
  const d = db()
  const rows = d.prepare(`
    SELECT s.role                        AS raw_role,
           MAX(s.role_confidence)        AS confidence,
           COUNT(*)                      AS sessions,
           COALESCE(SUM(s.total_tokens),0) AS tokens,
           COALESCE(SUM(s.cost_usd),0)   AS cost,
           r.display_name                AS display_name,
           r.enabled                     AS enabled,
           r.merged_into                 AS merged_into
    FROM agent_sessions s
    LEFT JOIN agent_registry r ON r.project = s.project AND r.raw_role = s.role
    WHERE s.project = ?
    GROUP BY s.role, r.display_name, r.enabled, r.merged_into
    ORDER BY cost DESC, tokens DESC
  `).all(project) as Array<{
    raw_role: string; confidence: string; sessions: number; tokens: number; cost: number;
    display_name: string | null; enabled: number | null; merged_into: string | null;
  }>

  return rows.map(r => ({
    rawRole: r.raw_role,
    confidence: r.confidence,
    sessions: r.sessions,
    tokens: r.tokens,
    cost: r.cost,
    registered: r.enabled !== null,
    displayName: r.display_name,
    enabled: r.enabled === null ? null : r.enabled === 1,
    mergedInto: r.merged_into,
  }))
}

/** List the current registry rows for a project — used by the modal
 *  when the user needs to see what they already configured. */
export function listRegistry(project: string): RegistryRow[] {
  return db().prepare(`
    SELECT project, raw_role, display_name, enabled, merged_into, updated_at
    FROM agent_registry WHERE project = ? ORDER BY raw_role
  `).all(project) as RegistryRow[]
}

export type UpsertInput = {
  rawRole: string
  displayName?: string | null
  enabled?: boolean
  mergedInto?: string | null
}

/** Create or update a registry row. Validates merge target exists and
 *  isn't itself merged — no transitive / cyclic chains. */
export function upsertRegistry(project: string, input: UpsertInput): RegistryRow {
  const d = db()
  const now = new Date().toISOString()

  // Merge-target validation: must be a different raw_role that itself
  // isn't merged, and must also have (or will have) a registry row.
  if (input.mergedInto) {
    if (input.mergedInto === input.rawRole) {
      throw new Error('merged_into cannot equal raw_role')
    }
    const target = d.prepare(
      'SELECT merged_into FROM agent_registry WHERE project = ? AND raw_role = ?'
    ).get(project, input.mergedInto) as { merged_into: string | null } | undefined
    if (!target) throw new Error(`merge target "${input.mergedInto}" is not registered`)
    if (target.merged_into) throw new Error(`merge target "${input.mergedInto}" is itself merged`)
  }

  d.prepare(`
    INSERT INTO agent_registry (project, raw_role, display_name, enabled, merged_into, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(project, raw_role) DO UPDATE SET
      display_name = COALESCE(excluded.display_name, display_name),
      enabled      = excluded.enabled,
      merged_into  = excluded.merged_into,
      updated_at   = excluded.updated_at
  `).run(
    project,
    input.rawRole,
    input.displayName ?? null,
    input.enabled === false ? 0 : 1,
    input.mergedInto ?? null,
    now,
  )

  return d.prepare(`
    SELECT project, raw_role, display_name, enabled, merged_into, updated_at
    FROM agent_registry WHERE project = ? AND raw_role = ?
  `).get(project, input.rawRole) as RegistryRow
}

/** Remove a row (revert to "undetected"). Also clears any other rows
 *  that were merged into this one — orphan aliases make no sense. */
export function deleteRegistry(project: string, rawRole: string): void {
  const d = db()
  d.prepare('UPDATE agent_registry SET merged_into = NULL WHERE project = ? AND merged_into = ?')
    .run(project, rawRole)
  d.prepare('DELETE FROM agent_registry WHERE project = ? AND raw_role = ?')
    .run(project, rawRole)
}

/** Bulk "acknowledge all undetected roles as enabled" — convenience for
 *  the setup-banner's "Keep all as-is" action, which lets a skeptical
 *  user proceed without manual classification. Uses raw_role as
 *  display_name fallback (the modal lets them rename later). */
export function acknowledgeAllUndetected(project: string): number {
  const d = db()
  const now = new Date().toISOString()
  // Excludes `unknown` — see countUnclassified for rationale. Accepting
  // it would create a registry row the user can never meaningfully
  // edit because the modal hides unknown from the editable list.
  const undetected = d.prepare(`
    SELECT DISTINCT role FROM agent_sessions
    WHERE project = ? AND role != 'unknown' AND role NOT IN (
      SELECT raw_role FROM agent_registry WHERE project = ?
    )
  `).all(project, project) as Array<{ role: string }>

  const ins = d.prepare(`
    INSERT INTO agent_registry (project, raw_role, display_name, enabled, merged_into, updated_at)
    VALUES (?, ?, NULL, 1, NULL, ?)
    ON CONFLICT(project, raw_role) DO NOTHING
  `)
  const tx = d.transaction((rows: Array<{ role: string }>) => {
    for (const r of rows) ins.run(project, r.role, now)
  })
  tx(undetected)
  return undetected.length
}
