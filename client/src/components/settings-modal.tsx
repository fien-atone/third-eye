import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useT, type T } from '../i18n'
import { apiGet, apiPatch, apiPost } from '../api'
import type { SettingsResponse } from '../types'
import { pokeVersionPoll } from '../lib/version-poll'

/** Settings modal. Opened from the gear icon in AppHeader. Currently
 *  hosts only the Updates section — but the section/grid scaffolding
 *  is already in place so adding a new settings group later is just a
 *  new <section> inside the body. */
export function SettingsModal({ onClose }: { onClose: () => void }) {
  const t = useT()
  const qc = useQueryClient()
  const settings = useQuery<SettingsResponse>({
    queryKey: ['settings'],
    queryFn: () => apiGet<SettingsResponse>('/api/settings'),
  })

  // Local draft mirrors the server state — saved on Save, dropped on
  // Cancel/close. Avoids the half-applied state where toggling a
  // checkbox immediately changes server behavior; user clearly opts in
  // by clicking Save.
  // Updates section
  const [draftEnabled, setDraftEnabled] = useState<boolean | null>(null)
  const [draftInterval, setDraftInterval] = useState<number | null>(null)
  const enabled = draftEnabled ?? settings.data?.updates.enabled ?? true
  const intervalSeconds = draftInterval ?? settings.data?.updates.intervalSeconds ?? 3600
  // Ingest (auto-refresh) section
  const [draftIngestEnabled, setDraftIngestEnabled] = useState<boolean | null>(null)
  const [draftIngestInterval, setDraftIngestInterval] = useState<number | null>(null)
  const ingestEnabled = draftIngestEnabled ?? settings.data?.ingest.enabled ?? false
  const ingestInterval = draftIngestInterval ?? settings.data?.ingest.intervalSeconds ?? 300
  const isDev = settings.data?.mode === 'dev'

  const mutation = useMutation({
    mutationFn: (next: {
      updates: { enabled: boolean; intervalSeconds: number }
      ingest: { enabled: boolean; intervalSeconds: number }
    }) => apiPatch<SettingsResponse>('/api/settings', next),
    onSuccess: data => {
      qc.setQueryData(['settings'], data)
      // Server scheduled a fresh poll ~1 s out; ping the singleton
      // poller to refetch /api/version right after so the UI catches
      // the new state instead of waiting up to 5 s for the next
      // tick.
      setTimeout(pokeVersionPoll, 1_500)
      // Same idea for /api/health — auto-ingest may have just been
      // toggled on, header should reflect that immediately.
      qc.invalidateQueries({ queryKey: ['health'] })
      onClose()
    },
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const dirty =
    (draftEnabled !== null && draftEnabled !== settings.data?.updates.enabled) ||
    (draftInterval !== null && draftInterval !== settings.data?.updates.intervalSeconds) ||
    (draftIngestEnabled !== null && draftIngestEnabled !== settings.data?.ingest.enabled) ||
    (draftIngestInterval !== null && draftIngestInterval !== settings.data?.ingest.intervalSeconds)

  // Rebuild is destructive (truncates every ingest table and re-
  // imports from disk), so we gate it behind a Confirm dialog and
  // a separate mutation. The /api/refresh endpoint returns 409
  // Conflict if anything else is in flight (manual refresh,
  // auto-tick), which we surface as `rebuildError`. Successful
  // completion triggers the same cache invalidations as a regular
  // refresh — every ingest-derived view needs to refetch.
  // Rebuild dialog state. The user picks which user-configured
  // tables (projects favorites / agent role config / widget
  // layouts) to wipe on top of the always-wiped telemetry. All
  // optional resets default to OFF — "I think my data is stale"
  // shouldn't silently nuke favorites the user spent time
  // setting.
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [resetProjects, setResetProjects] = useState(false)
  const [resetAgents, setResetAgents] = useState(false)
  const [resetLayouts, setResetLayouts] = useState(false)
  const [rebuildError, setRebuildError] = useState<string | null>(null)
  const [rebuildSuccessAt, setRebuildSuccessAt] = useState<{ rows: number; ms: number } | null>(null)
  const rebuild = useMutation({
    mutationFn: (targets: { projects: boolean; agents: boolean; layouts: boolean }) => {
      const flags: string[] = []
      if (targets.projects) flags.push('projects')
      if (targets.agents) flags.push('agents')
      if (targets.layouts) flags.push('layouts')
      const reset = flags.length > 0 ? `&reset=${flags.join(',')}` : ''
      return apiPost<{ ok: boolean; mode: string; total: number; durationMs: number }>(
        `/api/refresh?mode=rebuild${reset}`,
      )
    },
    onSuccess: data => {
      setRebuildError(null)
      qc.invalidateQueries({ queryKey: ['providers'] })
      qc.invalidateQueries({ queryKey: ['overview'] })
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['insights'] })
      qc.invalidateQueries({ queryKey: ['agents'] })
      qc.invalidateQueries({ queryKey: ['health'] })
      // Layouts query is keyed `['layout', screen]`. Invalidate
      // the whole prefix so every screen's layout (dashboard /
      // project / today) refetches — necessary when the user
      // checked "Reset saved widget layouts", and harmless when
      // they didn't (server returns the same row, react-query
      // structural-shares it). Without this the visible grid
      // keeps the pre-rebuild layout until next page reload,
      // even though the DB row was just deleted.
      qc.invalidateQueries({ queryKey: ['layout'] })
      setConfirmOpen(false)
      // KEEP the modal open — closing it silently after a 2 s
      // server round-trip leaves the user thinking nothing
      // happened. Show the success line; they close manually
      // when ready.
      setRebuildSuccessAt({ rows: data.total ?? 0, ms: data.durationMs ?? 0 })
    },
    onError: (err: Error) => {
      // ApiError (api.ts) maps the 409's JSON `error` field to
      // err.message, so plain string compare works for "busy".
      // Anything else (network, 500) falls back to genericError
      // formatting downstream.
      const msg = err.message || 'unknown'
      setRebuildError(msg)
      setRebuildSuccessAt(null)
      setConfirmOpen(false)
    },
  })

  const startRebuild = () => {
    setRebuildError(null)
    setRebuildSuccessAt(null)
    rebuild.mutate({ projects: resetProjects, agents: resetAgents, layouts: resetLayouts })
  }

  const save = () => mutation.mutate({
    updates: { enabled, intervalSeconds },
    ingest: { enabled: ingestEnabled, intervalSeconds: ingestInterval },
  })

  return (
    <>
      <div className="update-modal-backdrop" onClick={onClose} />
      <div className="update-modal settings-modal" role="dialog" aria-modal="true" aria-label={t('settings.title')}>
        <div className="update-modal-head">
          <div>
            <div className="update-modal-title">{t('settings.title')}</div>
            <div className="update-modal-subtitle">{t('settings.subtitle')}</div>
          </div>
          <button className="update-modal-close" onClick={onClose} aria-label={t('settings.close')}>×</button>
        </div>

        <div className="update-modal-body">
          <section className="settings-section">
            <h3 className="settings-section-title">{t('settings.updates.title')}</h3>
            <p className="settings-section-help">{t('settings.updates.help')}</p>

            <label className="settings-row settings-row-toggle">
              <span className="settings-row-label">{t('settings.updates.enabledLabel')}</span>
              <span className={`toggle${enabled ? ' is-on' : ''}`}>
                <input
                  type="checkbox"
                  className="toggle-input"
                  checked={enabled}
                  onChange={e => setDraftEnabled(e.target.checked)}
                />
                <span className="toggle-track" aria-hidden="true">
                  <span className="toggle-thumb" />
                </span>
              </span>
            </label>

            <div className={`settings-row settings-row-stacked${enabled ? '' : ' is-disabled'}`}>
              <span className="settings-row-label">{t('settings.updates.frequencyLabel')}</span>
              <span className="select-wrap">
                <select
                  className="select-styled"
                  value={intervalSeconds}
                  disabled={!enabled}
                  onChange={e => setDraftInterval(parseInt(e.target.value, 10))}
                >
                  {/* Dev-only sub-hour presets at the top — stripped
                      from the prod UI and floor-clamped server-side
                      so a tampered-with request can't hammer GitHub. */}
                  {isDev && <option value={30}>{t('settings.updates.freq.dev30s')}</option>}
                  {isDev && <option value={60}>{t('settings.updates.freq.dev1m')}</option>}
                  {isDev && <option value={300}>{t('settings.updates.freq.dev5m')}</option>}
                  <option value={3600}>{t('settings.updates.freq.hourly')}</option>
                  <option value={6 * 3600}>{t('settings.updates.freq.every6h')}</option>
                  <option value={24 * 3600}>{t('settings.updates.freq.daily')}</option>
                  <option value={168 * 3600}>{t('settings.updates.freq.weekly')}</option>
                </select>
                <svg className="select-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </span>
              {isDev && (
                <span className="settings-dev-hint">{t('settings.updates.devHint')}</span>
              )}
            </div>
          </section>

          <section className="settings-section">
            <h3 className="settings-section-title">{t('settings.ingest.title')}</h3>
            <p className="settings-section-help">{t('settings.ingest.help')}</p>

            <label className="settings-row settings-row-toggle">
              <span className="settings-row-label">{t('settings.ingest.enabledLabel')}</span>
              <span className={`toggle${ingestEnabled ? ' is-on' : ''}`}>
                <input
                  type="checkbox"
                  className="toggle-input"
                  checked={ingestEnabled}
                  onChange={e => setDraftIngestEnabled(e.target.checked)}
                />
                <span className="toggle-track" aria-hidden="true">
                  <span className="toggle-thumb" />
                </span>
              </span>
            </label>

            <div className={`settings-row settings-row-stacked${ingestEnabled ? '' : ' is-disabled'}`}>
              <span className="settings-row-label">{t('settings.ingest.frequencyLabel')}</span>
              <span className="select-wrap">
                <select
                  className="select-styled"
                  value={ingestInterval}
                  disabled={!ingestEnabled}
                  onChange={e => setDraftIngestInterval(parseInt(e.target.value, 10))}
                >
                  {/* Sub-minute presets only in dev. Production floor is
                      60 s — see clampIngestInterval in lib/settings.ts. */}
                  {isDev && <option value={30}>{t('settings.ingest.freq.dev30s')}</option>}
                  <option value={60}>{t('settings.ingest.freq.every1m')}</option>
                  <option value={300}>{t('settings.ingest.freq.every5m')}</option>
                  <option value={900}>{t('settings.ingest.freq.every15m')}</option>
                  <option value={3600}>{t('settings.ingest.freq.hourly')}</option>
                </select>
                <svg className="select-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </span>
            </div>
          </section>

          {/* Maintenance — destructive operations live behind their
              own section + confirm dialog so they're never one click
              away. Rebuild is the only entry today; full DB export /
              import etc. will land here later. */}
          <section className="settings-section">
            <h3 className="settings-section-title">{t('settings.maintenance.title')}</h3>
            <p className="settings-section-help">{t('settings.maintenance.help')}</p>

            <div className="settings-row settings-row-stacked">
              <span className="settings-row-label">{t('settings.maintenance.rebuildLabel')}</span>
              <button
                type="button"
                className="ghost is-destructive"
                onClick={() => {
                  setRebuildError(null)
                  setRebuildSuccessAt(null)
                  // Reset checkbox state every time the dialog
                  // opens — destructive choices are intentional,
                  // not sticky.
                  setResetProjects(false)
                  setResetAgents(false)
                  setResetLayouts(false)
                  setConfirmOpen(true)
                }}
                disabled={rebuild.isPending}
              >
                {rebuild.isPending ? t('settings.maintenance.rebuilding') : t('settings.maintenance.rebuildButton')}
              </button>
              {rebuildError && (
                <span className="settings-error">{
                  rebuildError === 'busy'
                    ? t('settings.maintenance.busyError')
                    : t('settings.maintenance.genericError', { msg: rebuildError })
                }</span>
              )}
              {rebuildSuccessAt && !rebuildError && (
                <span className="settings-success">{t('settings.maintenance.successFmt', {
                  rows: rebuildSuccessAt.rows.toLocaleString(),
                  seconds: (rebuildSuccessAt.ms / 1000).toFixed(1),
                })}</span>
              )}
            </div>
          </section>
        </div>

        {confirmOpen && (
          <RebuildDialog
            t={t}
            isPending={rebuild.isPending}
            resetProjects={resetProjects}
            setResetProjects={setResetProjects}
            resetAgents={resetAgents}
            setResetAgents={setResetAgents}
            resetLayouts={resetLayouts}
            setResetLayouts={setResetLayouts}
            onCancel={() => setConfirmOpen(false)}
            onConfirm={startRebuild}
          />
        )}

        <div className="update-modal-footer">
          <button onClick={onClose}>{t('settings.cancel')}</button>
          <button className="primary" onClick={save} disabled={!dirty || mutation.isPending}>
            {mutation.isPending ? t('settings.saving') : t('settings.save')}
          </button>
        </div>
      </div>
    </>
  )
}

/** Modal that lets the user pick what gets wiped on Rebuild.
 *  Telemetry tables (api_calls, tool_events, agent_sessions,
 *  codex_plan_daily) are always wiped — that's the point of
 *  Rebuild — so they're shown as a non-toggleable line. The three
 *  optional categories below correspond 1:1 to RebuildTargets on
 *  the server (lib/db.ts). All default OFF: a user clicking
 *  Rebuild because they think their data is stale shouldn't
 *  silently nuke project favorites or role configurations.
 *
 *  Confirm button stays disabled until the rebuild request lands;
 *  during that window the label flips to "Rebuilding…" so the
 *  user has feedback during the 2–7 s server round-trip. */
function RebuildDialog({
  t, isPending,
  resetProjects, setResetProjects,
  resetAgents, setResetAgents,
  resetLayouts, setResetLayouts,
  onCancel, onConfirm,
}: {
  t: T
  isPending: boolean
  resetProjects: boolean
  setResetProjects: (v: boolean) => void
  resetAgents: boolean
  setResetAgents: (v: boolean) => void
  resetLayouts: boolean
  setResetLayouts: (v: boolean) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isPending) onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isPending, onCancel])
  return (
    <>
      <div className="confirm-backdrop" onClick={isPending ? undefined : onCancel} />
      <div className="confirm-dialog rebuild-dialog" role="dialog" aria-modal="true" aria-label={t('settings.maintenance.confirmTitle')}>
        <h3 className="confirm-title">{t('settings.maintenance.confirmTitle')}</h3>
        <div className="confirm-message">
          <p>{t('settings.maintenance.confirmAlwaysIntro')}</p>
          <ul className="rebuild-targets-always">
            <li>{t('settings.maintenance.targetTelemetry')}</li>
          </ul>
          <p>{t('settings.maintenance.confirmOptionalIntro')}</p>
          <label className="rebuild-target-row">
            <input type="checkbox" checked={resetProjects}
              disabled={isPending}
              onChange={e => setResetProjects(e.target.checked)} />
            <span>
              <strong>{t('settings.maintenance.targetProjectsLabel')}</strong>
              <span className="rebuild-target-help">{t('settings.maintenance.targetProjectsHelp')}</span>
            </span>
          </label>
          <label className="rebuild-target-row">
            <input type="checkbox" checked={resetAgents}
              disabled={isPending}
              onChange={e => setResetAgents(e.target.checked)} />
            <span>
              <strong>{t('settings.maintenance.targetAgentsLabel')}</strong>
              <span className="rebuild-target-help">{t('settings.maintenance.targetAgentsHelp')}</span>
            </span>
          </label>
          <label className="rebuild-target-row">
            <input type="checkbox" checked={resetLayouts}
              disabled={isPending}
              onChange={e => setResetLayouts(e.target.checked)} />
            <span>
              <strong>{t('settings.maintenance.targetLayoutsLabel')}</strong>
              <span className="rebuild-target-help">{t('settings.maintenance.targetLayoutsHelp')}</span>
            </span>
          </label>
        </div>
        <div className="confirm-actions">
          <button type="button" className="confirm-btn-cancel" onClick={onCancel} disabled={isPending}>
            {t('settings.cancel')}
          </button>
          <button
            type="button"
            className="confirm-btn-ok is-destructive"
            onClick={onConfirm}
            disabled={isPending}
            autoFocus
          >
            {isPending ? t('settings.maintenance.rebuilding') : t('settings.maintenance.confirmYes')}
          </button>
        </div>
      </div>
    </>
  )
}
