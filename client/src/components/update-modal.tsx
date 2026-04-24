import { useEffect, useState } from 'react'
import { useT } from '../i18n'
import type { VersionResponse } from '../types'

type InstallMethod = 'docker' | 'node'

/** Modal shown when the user clicks the "update available" pill in
 *  the header. Provides copy-pasteable commands for both install
 *  methods + a link to the GitHub release notes. Keeps all the
 *  "how do I actually install this?" cognitive load in one place. */
export function UpdateModal({ version, onClose }: { version: VersionResponse; onClose: () => void }) {
  const t = useT()
  const [method, setMethod] = useState<InstallMethod>('docker')
  const [copied, setCopied] = useState(false)

  const command = method === 'docker'
    ? 'cd third-eye && git pull && docker compose up -d --build'
    : 'cd third-eye && git pull && npm install && npm start'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* user copied manually, clipboard API blocked */
    }
  }

  const ago = version.latestPublishedAt
    ? formatRelative(version.latestPublishedAt, t)
    : null

  return (
    <>
      <div className="update-modal-backdrop" onClick={onClose} />
      <div className="update-modal" role="dialog" aria-modal="true" aria-label={t('update.title')}>
        <div className="update-modal-head">
          <div>
            <div className="update-modal-title">{t('update.title')}</div>
            <div className="update-modal-subtitle">
              {version.latestName ?? `v${version.latest}`}
              {ago && <span className="update-modal-ago"> · {ago}</span>}
            </div>
          </div>
          <button className="update-modal-close" onClick={onClose} aria-label={t('update.close')}>×</button>
        </div>

        <div className="update-modal-body">
          <div className="update-modal-running">
            {t('update.youreRunning', { current: version.current })}
          </div>

          <div className="update-modal-section-label">{t('update.pickMethod')}</div>

          <div className="chip-group update-modal-tabs">
            <button
              className={`chip${method === 'docker' ? ' active' : ''}`}
              onClick={() => setMethod('docker')}
            >{t('update.docker')}</button>
            <button
              className={`chip${method === 'node' ? ' active' : ''}`}
              onClick={() => setMethod('node')}
            >{t('update.node')}</button>
          </div>

          <div className="update-modal-cmd">
            <code>{command}</code>
            <button className="update-modal-copy" onClick={copy} aria-label={t('update.copy')}>
              {copied ? '✓' : '📋'}
            </button>
          </div>

          <div className="update-modal-note">
            {method === 'docker' ? t('update.dockerNote') : t('update.nodeNote')}
          </div>

          {version.latestUrl && (
            <a
              className="update-modal-release-link"
              href={version.latestUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('update.viewReleaseNotes')} ↗
            </a>
          )}
        </div>

        <div className="update-modal-footer">
          <button className="primary" onClick={onClose}>{t('update.gotIt')}</button>
        </div>
      </div>
    </>
  )
}

function formatRelative(iso: string, t: ReturnType<typeof useT>): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const diff = Math.max(0, now - then)
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return t('update.ago.minutes', { n: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('update.ago.hours', { n: hours })
  const days = Math.floor(hours / 24)
  return t('update.ago.days', { n: days })
}
