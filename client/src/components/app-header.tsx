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
  const outdated = !!version?.isOutdated
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
          {outdated && version?.latest && (
            /* Just "↑ New version available" — no numbers, no arrow.
               Version specifics live inside the modal where they're
               actually useful. */
            <button
              className="version-update-pill"
              onClick={() => setUpdateOpen(true)}
              title={t('update.pillTooltip', { current: version.current, latest: version.latest })}
            >
              <span aria-hidden="true">↑</span>
              <span>{t('update.pillLabel')}</span>
            </button>
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
    </>
  )
}
