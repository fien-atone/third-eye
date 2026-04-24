/**
 * Setup banner — appears above the dashboard grid when there are
 * ACTIONABLE detected roles the user hasn't classified yet. Banner
 * and modal lifecycles are intentionally separate: the modal lives
 * one level up in Dashboard screen so triggering components (this
 * banner, the widget's Manage button, future Settings entry) can all
 * open the same instance. Banner only fires the open callback.
 *
 * Banner retires permanently for a project once the user has at
 * least one registry row — first-time setup is a one-shot CTA. Later
 * affordances (project-header Manage button) cover ongoing management.
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
  const actionableCount = (detected.data?.detected ?? [])
    .filter(r => r.rawRole !== 'unknown').length
  const configured = detected.data?.configured ?? false

  if (actionableCount === 0) return null
  if (configured) return null

  return (
    <div style={bannerStyle}>
      <div style={{ flex: 1 }}>
        <div style={headerRow}>
          <strong>{t('agents.banner.title')}</strong>
        </div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
          {t('agents.banner.projectBody', {
            n: actionableCount,
            roles: actionableCount === 1 ? t('agents.banner.roleOne') : t('agents.banner.roleMany'),
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
