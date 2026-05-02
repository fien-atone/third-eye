/**
 * Setup banner — appears above the dashboard grid when there are
 * ACTIONABLE roles the user hasn't classified in this project's
 * agent_registry yet. Banner and modal lifecycles are intentionally
 * separate: the modal lives one level up in Dashboard screen so
 * triggering components (this banner, the widget's Manage button,
 * future Settings entry) can all open the same instance.
 *
 * Re-triggers when fresh roles appear. Originally banner retired
 * permanently after first setup, but that hid the case where
 * Claude Code rolls out new agentTypes (e.g. "general-purpose"
 * arrived after the initial classification round) — those new
 * roles would sit forever in the unclassified bucket without the
 * user noticing. Now: banner shows whenever there's at least one
 * unregistered, actionable role; copy adapts based on whether the
 * project has been configured before (first-run vs follow-up).
 */

import { useT } from '../i18n'
import { useDetectedRoles, useUnclassifiedGlobal } from '../lib/agents'

export function AgentsSetupBanner({
  projectId, onOpenRegistry,
}: {
  projectId: string | null
  onOpenRegistry?: () => void
}) {
  return projectId
    ? <ProjectBanner projectId={projectId} onOpen={onOpenRegistry} />
    : <GlobalBanner />
}

function ProjectBanner({ projectId, onOpen }: { projectId: string; onOpen?: () => void }) {
  const t = useT()
  const detected = useDetectedRoles(projectId)
  // Count roles that are (a) actionable (not "unknown" — those are
  // task-source agents we can't classify by definition) AND (b) NOT
  // already in the user's registry. This is what's actually
  // unsettled — a registered role isn't a CTA target.
  const newUnclassified = (detected.data?.detected ?? [])
    .filter(r => r.rawRole !== 'unknown' && !r.registered).length
  const configured = detected.data?.configured ?? false

  if (newUnclassified === 0) return null

  // First-run vs follow-up copy. Returning users (configured=true)
  // get phrasing that emphasizes "NEW since last time" so they
  // don't read it as a duplicate of the same banner they already
  // dismissed.
  const titleKey = configured ? 'agents.banner.titleNew' : 'agents.banner.title'
  const bodyKey = configured ? 'agents.banner.projectBodyNew' : 'agents.banner.projectBody'

  return (
    <div style={bannerStyle}>
      <div style={{ flex: 1 }}>
        <div style={headerRow}>
          <strong>{t(titleKey)}</strong>
        </div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
          {t(bodyKey, {
            n: newUnclassified,
            roles: newUnclassified === 1 ? t('agents.banner.roleOne') : t('agents.banner.roleMany'),
          })}
        </div>
      </div>
      <button onClick={onOpen} disabled={!onOpen} style={ctaStyle}>
        {t('agents.banner.cta')}
      </button>
    </div>
  )
}

function GlobalBanner() {
  const t = useT()
  const q = useUnclassifiedGlobal()
  const n = q.data?.count ?? 0
  const anyConfigured = q.data?.anyConfigured ?? false
  if (anyConfigured || n === 0) return null
  return (
    <div style={bannerStyle}>
      <div style={{ flex: 1 }}>
        <div style={headerRow}>
          <strong>{t('agents.banner.title')}</strong>
        </div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
          {t('agents.banner.globalBody', {
            n,
            roles: n === 1 ? t('agents.banner.roleOne') : t('agents.banner.roleMany'),
          })}
        </div>
      </div>
    </div>
  )
}

const bannerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  padding: '12px 16px',
  margin: '0 0 16px',
  background: 'var(--experimental-soft, rgba(124, 58, 237, 0.08))',
  border: '1px solid var(--experimental-border, rgba(124, 58, 237, 0.3))',
  borderRadius: 8,
}

const headerRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, fontSize: 14,
}

const ctaStyle: React.CSSProperties = {
  padding: '6px 14px',
  fontSize: 13,
  fontWeight: 600,
  borderRadius: 6,
  border: '1px solid var(--experimental, #7c3aed)',
  background: 'var(--experimental, #7c3aed)',
  color: 'white',
  cursor: 'pointer',
}
