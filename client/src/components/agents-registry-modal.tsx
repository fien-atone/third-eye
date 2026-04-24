/**
 * Agents Registry modal — per-project classification of discovered
 * agent roles. Uses a pending-commit model: every decision accumulates
 * in local state and nothing hits the DB until the user clicks Apply.
 * Rationale: previous commit-on-every-click UX had a nasty trap —
 * tapping one checkbox instantly flipped `configured=true`, which
 * hid the setup banner forever. If the user hadn't actually finished
 * classifying, they had no way back in. Pending-commit keeps "in
 * progress" and "finished" as distinct states.
 *
 * `unknown` surfaces as a read-only summary strip because the user
 * has nothing to act on there — it's the detector's "no signal" marker.
 *
 * Merge (aliasing one role into another) is intentionally removed from
 * MVP — no confirmed use case yet. The `merged_into` column in the DB
 * stays for forward compat but no UI reaches it.
 */

import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useT, type T } from '../i18n'
import {
  useDetectedRoles, useUpsertRole, useDeleteRole,
  type DetectedRole,
} from '../lib/agents'
import { HighlightedText } from './widgets-misc'
import { ConfirmDialog } from './confirm-dialog'

type Decision = 'agent' | 'not-agent'

export function AgentsRegistryModal({
  open, onClose, projectId,
}: {
  open: boolean
  onClose: () => void
  projectId: string | null
}) {
  if (!open || !projectId) return null
  return <ModalBody onClose={onClose} projectId={projectId} />
}

/** Compute the "current" per-role state as the user sees it right now:
 *  pending override if touched, else whatever the server has. */
function currentDecision(role: DetectedRole, pending: Map<string, Decision>): Decision {
  const p = pending.get(role.rawRole)
  if (p) return p
  return role.registered && role.enabled ? 'agent' : 'not-agent'
}

/** Server-side decision — baseline for detecting whether a pending
 *  override is actually a change worth saving. */
function serverDecision(role: DetectedRole): Decision {
  return role.registered && role.enabled ? 'agent' : 'not-agent'
}

/** Local rename buffer vs server display name. Null/empty treated uniformly. */
function normalizedName(s: string | null | undefined): string {
  return (s ?? '').trim()
}

function ModalBody({ onClose, projectId }: { onClose: () => void; projectId: string }) {
  const t = useT()
  const qc = useQueryClient()
  const detected = useDetectedRoles(projectId)
  const upsert = useUpsertRole(projectId)
  const del = useDeleteRole(projectId)

  // Pending local state — nothing hits the DB until Apply.
  const [pendingDecision, setPendingDecision] = useState<Map<string, Decision>>(new Map())
  const [pendingName, setPendingName] = useState<Map<string, string>>(new Map())
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false)

  const rows = detected.data?.detected ?? []
  const unknownRow = rows.find(r => r.rawRole === 'unknown') ?? null
  const actionableAll = rows.filter(r => r.rawRole !== 'unknown')

  // Filter by query — matches against raw role name AND the pending /
  // server display name so a user who renamed "frontend-dev" to
  // "Web UI" can still find it either way. Case-insensitive substring.
  const actionable = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return actionableAll
    return actionableAll.filter(r => {
      if (r.rawRole.toLowerCase().includes(q)) return true
      const name = (pendingName.has(r.rawRole) ? pendingName.get(r.rawRole)! : (r.displayName ?? '')).toLowerCase()
      return name.includes(q)
    })
  }, [actionableAll, query, pendingName])

  // Work out which rows differ from server → drives the Apply button
  // label and whether it's enabled.
  const dirty = useMemo(() => {
    const out: Array<{ role: DetectedRole; wants: Decision; name: string | null }> = []
    for (const r of actionable) {
      const wants = currentDecision(r, pendingDecision)
      const baseline = serverDecision(r)
      const nameRaw = pendingName.has(r.rawRole) ? pendingName.get(r.rawRole)! : (r.displayName ?? '')
      const nameNext = normalizedName(nameRaw)
      const nameBase = normalizedName(r.displayName)
      const decisionChanged = wants !== baseline
      const nameChanged = wants === 'agent' && nameNext !== nameBase
      if (decisionChanged || nameChanged) {
        out.push({ role: r, wants, name: nameNext || null })
      }
    }
    return out
  }, [actionable, pendingDecision, pendingName])

  const toggle = (role: DetectedRole) => {
    const next = new Map(pendingDecision)
    const current = currentDecision(role, pendingDecision)
    const target: Decision = current === 'agent' ? 'not-agent' : 'agent'
    const baseline = serverDecision(role)
    if (target === baseline) next.delete(role.rawRole)      // reverted to server state → drop pending
    else next.set(role.rawRole, target)
    setPendingDecision(next)
  }

  const setName = (role: DetectedRole, value: string) => {
    const next = new Map(pendingName)
    next.set(role.rawRole, value)
    setPendingName(next)
  }

  /** "Mark everything as agent" — bulk action, still pending, still
   *  requires Apply to commit. Doesn't touch display names. */
  const markAllAsAgent = () => {
    const next = new Map(pendingDecision)
    for (const r of actionable) {
      const baseline = serverDecision(r)
      if (baseline === 'agent') next.delete(r.rawRole)
      else next.set(r.rawRole, 'agent')
    }
    setPendingDecision(next)
  }

  const apply = async () => {
    if (dirty.length === 0) return
    setApplying(true)
    setError(null)
    try {
      // Parallelise writes. Upsert for "make agent" + rename; delete for
      // "un-agent" (registered roles going back to unregistered). Plain
      // "not-agent" for never-registered roles needs no-op.
      await Promise.all(dirty.map(async d => {
        if (d.wants === 'agent') {
          await upsert.mutateAsync({
            rawRole: d.role.rawRole,
            enabled: true,
            displayName: d.name,
            mergedInto: d.role.mergedInto ?? null,
          })
        } else if (d.role.registered) {
          // was an agent in DB, user flipped to not-agent → delete row so
          // the role goes back to "undetected / Unclassified" state.
          await del.mutateAsync({ rawRole: d.role.rawRole })
        }
      }))
      // Clear local pending state now that it's committed.
      setPendingDecision(new Map())
      setPendingName(new Map())
      // Invalidate downstream caches: the registry itself, and the
      // dashboard overview — the agent-telemetry widget reads from
      // /api/overview so it needs a refetch to reflect the new
      // registry (otherwise it keeps showing stale pre-Apply numbers).
      qc.invalidateQueries({ queryKey: ['agents'] })
      qc.invalidateQueries({ queryKey: ['overview'] })
      // Apply is the explicit "I'm done" affordance — close the modal
      // on success. Leaving it open after commit used to invite a
      // "did anything happen?" moment; closing removes the ambiguity.
      onClose()
    } catch (err) {
      setError((err as Error).message || t('agents.modal.saveError'))
    } finally {
      setApplying(false)
    }
  }

  const confirmClose = () => {
    if (dirty.length > 0 && !applying) {
      setConfirmDiscardOpen(true)
      return
    }
    onClose()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('agents.modal.title')}
      // Only react to clicks that hit the backdrop ITSELF. Without the
      // target check, any bubbled event from nested DOM (e.g. the
      // ConfirmDialog rendered further down as a sibling of the inner
      // panel) would re-trigger confirmClose after the user just
      // dismissed the confirm — making "Keep editing" appear broken.
      onClick={e => { if (e.target === e.currentTarget) confirmClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--panel, #fff)',
          color: 'var(--text, #111)',
          borderRadius: 10,
          maxWidth: 720, width: '100%',
          maxHeight: '85vh',
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* ── Sticky header ───────────────────────────────────────── */}
        <div style={{
          padding: '20px 24px 16px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16 }}>
            <h2 style={{ margin: 0, fontSize: 20 }}>{t('agents.modal.title')}</h2>
            <button className="ghost" onClick={confirmClose} aria-label={t('agents.modal.close')}>✕</button>
          </div>
          <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.5 }}>
            {t('agents.modal.intro', { apply: t('agents.modal.apply') })}
          </p>
          <p style={{
            margin: '6px 0 0',
            fontSize: 11,
            color: 'var(--text-dim)',
            fontStyle: 'italic',
            lineHeight: 1.5,
          }}>
            {t('agents.modal.disclaimer')}
          </p>
          {actionableAll.length > 4 && (
            <input
              type="search"
              placeholder={t('agents.modal.searchPlaceholder', {
                n: actionableAll.length,
                roles: actionableAll.length === 1 ? t('agents.banner.roleOne') : t('agents.banner.roleMany'),
              })}
              value={query}
              onChange={e => setQuery(e.target.value)}
              aria-label={t('agents.modal.searchPlaceholder', {
                n: actionableAll.length,
                roles: actionableAll.length === 1 ? t('agents.banner.roleOne') : t('agents.banner.roleMany'),
              })}
              style={{
                marginTop: 12, width: '100%',
                padding: '6px 10px', fontSize: 13,
                background: 'var(--panel, #fff)', color: 'inherit',
                border: '1px solid var(--border)',
                borderRadius: 6,
              }}
            />
          )}
        </div>

        {/* ── Scrollable body ─────────────────────────────────────── */}
        <div style={{ padding: '16px 24px', overflowY: 'auto', flex: 1 }}>
          {detected.isLoading && <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>{t('agents.modal.loading')}</div>}
          {detected.isError && (
            <div style={{ fontSize: 13, color: 'var(--bad, #c00)' }}>
              {t('agents.modal.loadError', { err: (detected.error as Error).message })}
            </div>
          )}

          {unknownRow && (
            <div style={{
              padding: '10px 12px',
              marginBottom: 12,
              borderRadius: 6,
              background: 'var(--bg-2)',
              fontSize: 12,
              color: 'var(--text-dim)',
              lineHeight: 1.5,
            }}>
              {t('agents.modal.unknownRow', {
                n: unknownRow.sessions,
                sessions: unknownRow.sessions === 1 ? t('agents.modal.sessionOne') : t('agents.modal.sessionMany'),
                cost: unknownRow.cost.toFixed(2),
              })}
            </div>
          )}

          {actionableAll.length === 0 && !detected.isLoading && (
            <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>
              {t('agents.modal.emptyRoles')}
            </div>
          )}
          {actionableAll.length > 0 && actionable.length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>
              {t('agents.modal.noMatch', { q: query })}{' '}
              <button
                className="ghost"
                onClick={() => setQuery('')}
                style={{ fontSize: 12, textDecoration: 'underline', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)' }}
              >{t('agents.modal.clearFilter')}</button>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {actionable.map(r => (
              <RoleRow
                key={r.rawRole}
                role={r}
                decision={currentDecision(r, pendingDecision)}
                isDirty={pendingDecision.has(r.rawRole) || pendingName.has(r.rawRole)}
                nameValue={pendingName.has(r.rawRole) ? pendingName.get(r.rawRole)! : (r.displayName ?? '')}
                query={query}
                onToggle={() => toggle(r)}
                onNameChange={v => setName(r, v)}
              />
            ))}
          </div>
        </div>

        {/* ── Sticky footer ───────────────────────────────────────── */}
        <div style={{
          padding: '12px 24px',
          borderTop: '1px solid var(--border)',
          background: 'var(--panel-2)',
          flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', flex: 1, minWidth: 0 }}>
            {error
              ? <span style={{ color: 'var(--bad)' }}>{error}</span>
              : dirty.length === 0
                ? (actionable.length > 0 ? t('agents.modal.footerTrust') : '')
                : t('agents.modal.footerPending', {
                    n: dirty.length,
                    changes: dirty.length === 1 ? t('agents.modal.changeOne') : t('agents.modal.changeMany'),
                  })}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {dirty.length === 0 && actionable.length > 0 && (
              <button
                className="ghost"
                disabled={applying}
                onClick={markAllAsAgent}
                style={{ fontSize: 13 }}
              >
                {t('agents.modal.markAll')}
              </button>
            )}
            <button
              onClick={apply}
              disabled={dirty.length === 0 || applying}
              style={{
                padding: '6px 14px',
                fontSize: 13, fontWeight: 600, borderRadius: 6,
                border: '1px solid var(--accent)',
                background: dirty.length === 0 || applying ? 'transparent' : 'var(--accent)',
                color: dirty.length === 0 || applying ? 'var(--text-dim)' : 'white',
                cursor: dirty.length === 0 || applying ? 'default' : 'pointer',
                opacity: dirty.length === 0 ? 0.5 : 1,
              }}
            >
              {applying
                ? t('agents.modal.applying')
                : dirty.length > 0
                  ? t('agents.modal.applyWithCount', { n: dirty.length })
                  : t('agents.modal.apply')}
            </button>
          </div>
        </div>
      </div>

      {/* In-app discard confirmation — replaces window.confirm() which
       *  looked out of place (native browser chrome, no i18n of button
       *  labels). Escape / Enter keys are handled by ConfirmDialog. */}
      <ConfirmDialog
        open={confirmDiscardOpen}
        title={t('agents.modal.discardTitle')}
        message={t('agents.modal.discardConfirm', {
          n: dirty.length,
          changes: dirty.length === 1 ? t('agents.modal.changeOne') : t('agents.modal.changeMany'),
        })}
        confirmLabel={t('agents.modal.discardOk')}
        cancelLabel={t('agents.modal.discardCancel')}
        tone="destructive"
        onConfirm={() => { setConfirmDiscardOpen(false); onClose() }}
        onCancel={() => setConfirmDiscardOpen(false)}
      />
    </div>
  )
}

function RoleRow({
  role, decision, isDirty, nameValue, query, onToggle, onNameChange,
}: {
  role: DetectedRole
  decision: Decision
  isDirty: boolean
  nameValue: string
  query: string
  onToggle: () => void
  onNameChange: (v: string) => void
}) {
  const t: T = useT()
  const isAgent = decision === 'agent'

  // Left rail encodes at-a-glance state:
  //   accent (filled) = currently marked as agent (pending or saved)
  //   transparent     = currently not an agent
  //   purple dirty dot = has unsaved pending change
  const rail = isAgent ? 'var(--accent)' : 'transparent'

  return (
    <div style={{
      padding: 10,
      borderRadius: 6,
      background: isAgent ? 'var(--bg-2)' : 'transparent',
      border: '1px solid var(--border)',
      borderLeft: `3px solid ${rail}`,
      position: 'relative',
    }}>
      {isDirty && (
        <span
          title={t('agents.modal.unsavedDot')}
          style={{
            position: 'absolute', top: 8, right: 8,
            width: 6, height: 6, borderRadius: '50%',
            background: 'var(--experimental)',
          }}
        />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'center' }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14, fontFamily: 'var(--mono, ui-monospace, monospace)' }}>
            <HighlightedText text={role.rawRole} query={query} />
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
            {t('agents.modal.roleSessionStats', {
              n: role.sessions,
              sessions: role.sessions === 1 ? t('agents.modal.sessionOne') : t('agents.modal.sessionMany'),
              cost: role.cost.toFixed(2),
            })}
          </div>
        </div>
        <button
          onClick={onToggle}
          style={{
            padding: '5px 12px',
            fontSize: 12, fontWeight: 600,
            borderRadius: 999,
            border: isAgent ? '1px solid var(--accent)' : '1px solid var(--border-strong)',
            background: isAgent ? 'var(--accent)' : 'transparent',
            color: isAgent ? 'white' : 'var(--text-2)',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            minWidth: 110,
          }}
        >
          {isAgent ? t('agents.modal.markToggleOn') : t('agents.modal.markToggleOff')}
        </button>
      </div>

      {isAgent && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--border)' }}>
          <label style={{ fontSize: 12, color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 8 }}>
            {t('agents.modal.displayNameLabel')}
            <input
              type="text"
              placeholder={role.rawRole}
              value={nameValue}
              onChange={e => onNameChange(e.target.value)}
              style={{
                flex: 1, padding: '4px 8px', fontSize: 13,
                background: 'var(--panel, #fff)', color: 'inherit',
                border: '1px solid var(--border)',
                borderRadius: 4,
              }}
            />
          </label>
        </div>
      )}
    </div>
  )
}
