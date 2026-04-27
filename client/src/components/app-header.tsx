import { useState } from 'react'
import { useT } from '../i18n'
import { hrefFor, navigate } from '../router'
import { Logo } from '../Logo'
import { fmtRel } from '../lib/format'
import type { Theme } from '../theme'
import type { VersionResponse } from '../types'
import { ThemeToggle } from './theme-toggle'
import { LocaleSwitcher } from './locale-switcher'
import { UpdateModal } from './update-modal'
import { SettingsModal } from './settings-modal'
import { semverCompare } from '../lib/semver'

/** Top app shell: brand + version + last-refresh, refresh button,
 *  locale + theme controls, and the dashboard/projects tabs. Tabs hide
 *  on the not-found screen so the user isn't tempted to navigate within
 *  a broken state. */
export function AppHeader({
  lastIngestAt, isRefreshing, onRefresh,
  theme, setTheme,
  showTabs, dashboardTabActive, projectsTabActive, dayTabActive,
  version,
}: {
  lastIngestAt: string | null
  isRefreshing: boolean
  onRefresh: () => void
  theme: Theme
  setTheme: (t: Theme) => void
  showTabs: boolean
  dashboardTabActive: boolean
  projectsTabActive: boolean
  dayTabActive: boolean
  version: VersionResponse | undefined
}) {
  const t = useT()
  const [updateOpen, setUpdateOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Compute "outdated" client-side: compare the bundle version the user
  // is actually looking at (__APP_VERSION__, baked in at Vite build time)
  // against the latest GitHub release the server polled. Doing the
  // comparison on the server used to produce mismatched UI in dev when
  // the server restarted but Vite didn't (or vice versa).
  const currentVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : null
  const outdated = !!(currentVersion && version?.latest && semverCompare(version.latest, currentVersion) > 0)
  // "Up to date" badge: only show once we have a definitive answer
  // from GitHub (latest !== null) AND we're not currently outdated.
  // Suppressed while a poll is in flight so the user sees the spinner
  // instead of a stale "all good" indicator that might flip seconds
  // later.
  const upToDate = !!(version?.latest && !outdated && !version.checking)
  const checking = !!version?.checking
  return (
    <>
      <div className="header">
        <div className="brand">
          <a
            className="brand-link"
            href="/"
            onClick={e => { e.preventDefault(); navigate({ name: 'home' }) }}
            aria-label="Home"
          >
            <Logo size={28} />
            <h1>Third Eye</h1>
          </a>
          {typeof __APP_VERSION__ !== 'undefined' && (
            <span className="version-badge" title={`v${__APP_VERSION__}`}>v{__APP_VERSION__}</span>
          )}
          {/* Three mutually-exclusive update indicators next to the
              version badge:
                - checking → spinner ("checking GitHub right now")
                - outdated → orange pill with "New version available"
                - up to date → green checkmark with "running latest" tooltip
              Only one renders at a time; precedence is checking > outdated > up-to-date. */}
          {checking && (
            <span
              className="version-status-checking"
              role="status"
              aria-live="polite"
              title={t('update.checking')}
            >
              <span className="spinner" aria-hidden="true" />
              <span className="version-status-label">{t('update.checking')}</span>
            </span>
          )}
          {!checking && outdated && version?.latest && (
            <button
              className="version-update-pill"
              onClick={() => setUpdateOpen(true)}
              title={t('update.pillTooltip', { current: currentVersion ?? '?', latest: version.latest })}
            >
              <span aria-hidden="true">↑</span>
              <span>{t('update.pillLabel')}</span>
            </button>
          )}
          {!checking && upToDate && (
            <span
              className="version-status-uptodate"
              title={version?.lastCheckedAt
                ? t('update.upToDateAt', { when: new Date(version.lastCheckedAt).toLocaleString() })
                : t('update.upToDate')}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span className="version-status-label">{t('update.upToDate')}</span>
            </span>
          )}
          <span className="tagline">{t('header.tagline')}</span>
          <span className="meta">
            <span className="pulse" />
            {t('header.lastRefresh')}: {fmtRel(lastIngestAt, t)}
          </span>
        </div>
        <div className="right">
          <button
            className="ghost"
            onClick={onRefresh}
            disabled={isRefreshing}
            title={t('header.refreshTitle')}
          >
            {isRefreshing ? t('header.refreshing') : t('header.refresh')}
          </button>
          <LocaleSwitcher />
          <ThemeToggle theme={theme} setTheme={setTheme} />
          <button
            className="header-icon-btn"
            onClick={() => setSettingsOpen(true)}
            title={t('settings.openTitle')}
            aria-label={t('settings.openTitle')}
          >
            {/* Inline SVG keeps the header dependency-free; one icon
                doesn't justify a separate component file (yet). */}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </div>
      {showTabs && (
        <div className="tabs" role="tablist">
          <a
            role="tab"
            aria-selected={dashboardTabActive}
            className={`tab${dashboardTabActive ? ' active' : ''}`}
            href={hrefFor({ name: 'home' })}
          >{t('nav.dashboard')}</a>
          <a
            role="tab"
            aria-selected={dayTabActive}
            className={`tab${dayTabActive ? ' active' : ''}`}
            href={hrefFor({ name: 'today' })}
          >{t('nav.today')}</a>
          <a
            role="tab"
            aria-selected={projectsTabActive}
            className={`tab${projectsTabActive ? ' active' : ''}`}
            href={hrefFor({ name: 'projects' })}
          >{t('nav.projects')}</a>
        </div>
      )}
      {updateOpen && version && <UpdateModal version={version} onClose={() => setUpdateOpen(false)} />}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </>
  )
}
