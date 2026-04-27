import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useT } from '../i18n'
import { apiGet, apiPatch } from '../api'
import type { SettingsResponse } from '../types'

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
  const [draftEnabled, setDraftEnabled] = useState<boolean | null>(null)
  const [draftInterval, setDraftInterval] = useState<number | null>(null)
  const enabled = draftEnabled ?? settings.data?.updates.enabled ?? true
  const intervalHours = draftInterval ?? settings.data?.updates.intervalHours ?? 6

  const mutation = useMutation({
    mutationFn: (next: { enabled: boolean; intervalHours: number }) =>
      apiPatch<SettingsResponse>('/api/settings', { updates: next }),
    onSuccess: data => {
      qc.setQueryData(['settings'], data)
      // Server may have just (re)started the version-check loop with
      // a 1 s first-poll delay — refetch /api/version shortly after to
      // pick up the result, so the pill appears/disappears without
      // waiting for the 30 min React Query refetchInterval.
      setTimeout(() => qc.invalidateQueries({ queryKey: ['version'] }), 2_000)
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
    (draftInterval !== null && draftInterval !== settings.data?.updates.intervalHours)

  const save = () => mutation.mutate({ enabled, intervalHours })

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
                  value={intervalHours}
                  disabled={!enabled}
                  onChange={e => setDraftInterval(parseInt(e.target.value, 10))}
                >
                  <option value={1}>{t('settings.updates.freq.hourly')}</option>
                  <option value={6}>{t('settings.updates.freq.every6h')}</option>
                  <option value={24}>{t('settings.updates.freq.daily')}</option>
                  <option value={168}>{t('settings.updates.freq.weekly')}</option>
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
