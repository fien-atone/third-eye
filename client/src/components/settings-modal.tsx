import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useT } from '../i18n'
import { apiGet, apiPatch } from '../api'
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
        </div>

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
