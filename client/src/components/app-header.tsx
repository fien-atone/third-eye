import { useEffect, useState } from 'react'
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
  lastIngestAt, isRefreshing, autoIngestKind, onRefresh,
  theme, setTheme,
  showTabs, dashboardTabActive, projectsTabActive, dayTabActive,
  version,
}: {
  lastIngestAt: string | null
  isRefreshing: boolean
  /** Kind of ingest currently running on the server (incremental |
   *  full | rebuild), or null when idle. Drives the header spinner
   *  for background auto-ticks too — without this the user would see
   *  data change "by itself" with no visual cue that an ingest just
   *  happened. */
  autoIngestKind: 'incremental' | 'full' | 'rebuild' | null
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
  // Force a re-render every 30 s so the relative timestamp
  // ("just now" → "1m ago" → …) advances even when no other state
  // changes. Without this, react-query's structural sharing on the
  // /api/health poll returns the same `lastIngestAt` reference
  // across refetches, the component skips re-rendering, and the
  // wall-clock-derived `fmtRel(...)` value freezes at whatever it
  // was on first paint. fmtRel rounds down to whole minutes, so
  // 30 s cadence is plenty — no risk of users staring at a stale
  // "just now" past the one-minute boundary.
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(n => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])
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
            aria-label={t('common.home')}
          >
            <Logo size={28} />
            <h1>Third Eye</h1>
          </a>
          {typeof __APP_VERSION__ !== 'undefined' && (
            /* Version badge now hosts the up-to-date / checking
               indicators as small dot / spinner adornments in its top-
               right corner — like a notification dot on an app icon.
               Outdated stays a separate labeled pill (CTA) so it grabs
               attention; the informational states (running latest,
               actively polling) stay quiet and out of the user's way. */
            <span
              className={`version-badge${checking ? ' is-checking' : upToDate ? ' is-up-to-date' : ''}`}
              title={
                checking
                  ? t('update.checking')
                  : upToDate
                    ? (version?.lastCheckedAt
                        ? t('update.upToDateAt', { when: new Date(version.lastCheckedAt).toLocaleString() })
                        : t('update.upToDate'))
                    : `v${__APP_VERSION__}`
              }
            >
              v{__APP_VERSION__}
              {checking && <span className="version-badge-indicator is-checking" aria-hidden="true" />}
              {!checking && upToDate && <span className="version-badge-indicator is-up-to-date" aria-hidden="true" />}
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
          <span className="tagline">{t('header.tagline')}</span>
        </div>
        <div className="right">
          {/* Last data refresh — moved here from the brand cluster so
              "data freshness" sits next to the Refresh button (which
              acts on data) and is visually separated from "app version
              freshness" on the left. The pulse dot already implies
              live-data; tooltip spells out what the timestamp means. */}
          {/* Pulse dot doubles as the "something is ingesting" signal:
              amber + faster pulse while autoIngestKind is set, green +
              slow pulse when idle. Tooltip on the wrapper differentiates
              "this is when data was last refreshed" (idle) from "an
              ingest is running right now" (active). The label flip
              alone is too easy to miss for a 6-second auto-tick. */}
          {/* The "something is happening" signal merges three sources:
              - autoIngestKind: ingest the SERVER reports as in-flight
                (auto-tick or manual click another tab triggered).
              - isRefreshing: THIS tab's pending click. Flips
                synchronously with mutate(), giving instant feedback —
                without it there's up to 3 s of lag waiting for the
                next /api/health poll to confirm what we already know
                we just kicked off. Visually identical, semantically
                "we asked for it locally". */}
          {(() => {
            const ingesting = !!autoIngestKind || isRefreshing
            return (
              <span
                className={`meta${ingesting ? ' is-ingesting' : ''}`}
                title={ingesting ? t('header.autoIngestRunning') : t('header.lastRefresh')}
              >
                <span className={`pulse${ingesting ? ' is-active' : ''}`} />
                {fmtRel(lastIngestAt, t)}
              </span>
            )
          })()}
          {/* Spinner state merges manual click + background auto-tick:
              the user shouldn't have to know who triggered the ingest
              to interpret "is anything happening right now". The
              button stays clickable during a pure auto-tick (clicking
              dedups onto the in-flight scan and doesn't spawn a
              second one — guaranteed by the server-side lock); only
              the user's own pending mutation disables it, since
              rapid double-clicks during their OWN run feel buggy. */}
          <button
            className="ghost btn-stable"
            onClick={onRefresh}
            disabled={isRefreshing}
            title={
              isRefreshing ? t('header.refreshing')
                : autoIngestKind ? t('header.autoIngestRunning')
                : t('header.refreshTitle')
            }
          >
            {/* Stable-width pattern: render BOTH labels stacked in the
                same grid cell, hide the inactive one. Width is sized to
                the longest label so the button doesn't widen mid-tick.
                Translations vary — "Refresh"/"Refreshing…" widths differ
                in every locale — and a hard min-width in px would either
                clip or over-pad. The grid trick auto-fits whatever the
                current locale's longest label happens to be. */}
            <span className="btn-label-active" aria-hidden={!(isRefreshing || autoIngestKind)}>
              {t('header.refreshing')}
            </span>
            <span className="btn-label-idle" aria-hidden={isRefreshing || !!autoIngestKind}>
              {t('header.refresh')}
            </span>
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
