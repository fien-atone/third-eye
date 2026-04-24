/**
 * Agent distribution — per-agent totals (sessions, tokens, cost) in
 * an adaptive table. Uses the same fit-count + WidgetListMore footer
 * pattern as the insights widgets (models / branches / files) so the
 * user gets consistent "N of M · K hidden" feedback.
 *
 * Adaptive columns by tile width:
 *   w=2 → Agent · Cost (+ inline bar)
 *   w=3 → + Sessions
 *   w=4 → + Tokens + Tool uses
 */

import { useRef } from 'react'
import type { WidgetDef } from '../grid'
import type { T } from '../../i18n'
import type { OverviewResponse, AgentTelemetry } from '../../types'
import { ChartEmpty, PanelHeader, WidgetListMore } from '../../components/widgets-misc'
import { fmtCurrency, fmtInt, fmtTokens } from '../../lib/format'
import { useFitCount } from '../../lib/use-fit-count'
import { useT } from '../../i18n'

function AgentBadge({ name }: { name: string }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '1px 8px',
      borderRadius: 4,
      fontSize: 11,
      fontWeight: 500,
      background: 'color-mix(in srgb, var(--accent) 15%, transparent)',
      color: 'var(--accent)',
    }}>
      {name}
    </span>
  )
}

function DistributionBody({ byRole, w }: { byRole: AgentTelemetry['byRole']; w: number }) {
  const t = useT()
  const bodyRef = useRef<HTMLDivElement>(null)
  const footerRef = useRef<HTMLDivElement>(null)
  const visibleCount = useFitCount(bodyRef, byRole.length, {
    rowSelector: 'tbody > tr',
    reserveBottom: 36,
    footerRef,
  })
  const maxCost = byRole.reduce((m, r) => Math.max(m, r.cost), 0) || 1

  return (
    <div className="widget-panel-body widget-panel-body-fit" ref={bodyRef}>
      {byRole.length === 0 ? (
        <ChartEmpty hint={t('agents.distribution.empty')} />
      ) : (
        <>
          <table className="breakdown" style={{ width: '100%' }}>
            <colgroup>
              <col style={{ width: 160 }} />
              <col />
              {w >= 3 && <col style={{ width: 70 }} />}
              {w >= 4 && <col style={{ width: 90 }} />}
              {w >= 4 && <col style={{ width: 70 }} />}
              <col style={{ width: 80 }} />
            </colgroup>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>{t('agents.distribution.colAgent')}</th>
                <th />
                {w >= 3 && <th className="num">{t('agents.distribution.colSessions')}</th>}
                {w >= 4 && <th className="num">{t('agents.distribution.colTokens')}</th>}
                {w >= 4 && <th className="num">{t('agents.distribution.colTools')}</th>}
                <th className="num">{t('agents.distribution.colCost')}</th>
              </tr>
            </thead>
            <tbody>
              {byRole.slice(0, visibleCount).map(r => (
                <tr key={r.role}>
                  <td><AgentBadge name={r.role} /></td>
                  <td>
                    <div style={{
                      height: 6,
                      background: 'var(--accent)',
                      opacity: 0.6,
                      borderRadius: 3,
                      width: `${Math.max(2, (r.cost / maxCost) * 100)}%`,
                    }} />
                  </td>
                  {w >= 3 && <td className="num">{fmtInt(r.sessions)}</td>}
                  {w >= 4 && <td className="num">{fmtTokens(r.tokens)}</td>}
                  {w >= 4 && <td className="num">{fmtInt(r.toolUses)}</td>}
                  <td className="num">{fmtCurrency(r.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <WidgetListMore ref={footerRef} shown={visibleCount} total={byRole.length} />
        </>
      )}
    </div>
  )
}

export function agentDistributionWidget(t: T, data: OverviewResponse): WidgetDef {
  const { byRole } = data.agentTelemetry
  return {
    id: 'agent-distribution',
    title: t('agents.distribution.title'),
    description: t('agents.distribution.desc'),
    category: 'table',
    section: 'agents',
    sizes: [{ w: 2, h: 2 }, { w: 2, h: 3 }, { w: 3, h: 3 }, { w: 4, h: 3 }],
    minW: 2,
    minH: 2,
    render: ({ w }) => (
      <div className="panel widget-panel">
        <PanelHeader title={t('agents.distribution.title')} sub={t('agents.distribution.sub')} />
        <DistributionBody byRole={byRole} w={w} />
      </div>
    ),
  }
}
