/**
 * Agent top sessions — heaviest individual agent invocations by
 * cost. Uses the standard fit-count + WidgetListMore footer pattern
 * (like insights widgets) so the user always sees "N of M · K hidden".
 *
 * Adaptive columns by tile width:
 *   w=2 → Agent · Description · Cost
 *   w=3 → + Tokens + Duration
 *   w=4 → + Tools
 */

import { useRef } from 'react'
import type { WidgetDef } from '../grid'
import type { T } from '../../i18n'
import type { OverviewResponse, AgentTelemetry } from '../../types'
import { ChartEmpty, PanelHeader, WidgetListMore } from '../../components/widgets-misc'
import { fmtCurrency, fmtInt, fmtTokens } from '../../lib/format'
import { useFitCount } from '../../lib/use-fit-count'
import { useT } from '../../i18n'

function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  return `${(seconds / 3600).toFixed(1)}h`
}

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

function TopSessionsBody({ topSessions, w }: { topSessions: AgentTelemetry['topSessions']; w: number }) {
  const t = useT()
  const bodyRef = useRef<HTMLDivElement>(null)
  const footerRef = useRef<HTMLDivElement>(null)
  const visibleCount = useFitCount(bodyRef, topSessions.length, {
    rowSelector: 'tbody > tr',
    reserveBottom: 36,
    footerRef,
  })

  return (
    <div className="widget-panel-body widget-panel-body-fit" ref={bodyRef}>
      {topSessions.length === 0 ? (
        <ChartEmpty hint={t('agents.topSessions.empty')} />
      ) : (
        <>
          <table className="breakdown" style={{ width: '100%' }}>
            <colgroup>
              <col style={{ width: 120 }} />
              <col />
              {w >= 3 && <col style={{ width: 70 }} />}
              {w >= 4 && <col style={{ width: 60 }} />}
              {w >= 3 && <col style={{ width: 60 }} />}
              <col style={{ width: 80 }} />
            </colgroup>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>{t('agents.topSessions.colAgent')}</th>
                <th style={{ textAlign: 'left' }}>{t('agents.topSessions.colDescription')}</th>
                {w >= 3 && <th className="num">{t('agents.topSessions.colTokens')}</th>}
                {w >= 4 && <th className="num">{t('agents.topSessions.colTools')}</th>}
                {w >= 3 && <th className="num">{t('agents.topSessions.colDuration')}</th>}
                <th className="num">{t('agents.topSessions.colCost')}</th>
              </tr>
            </thead>
            <tbody>
              {topSessions.slice(0, visibleCount).map(s => (
                <tr key={`${s.source}:${s.agentId}`}>
                  <td><AgentBadge name={s.role} /></td>
                  <td
                    style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 0 }}
                    title={s.description || s.agentId}
                  >
                    {s.description || <span style={{ color: 'var(--text-dim)' }}>{s.agentId}</span>}
                  </td>
                  {w >= 3 && <td className="num">{fmtTokens(s.totalTokens)}</td>}
                  {w >= 4 && <td className="num">{fmtInt(s.toolUses)}</td>}
                  {w >= 3 && <td className="num">{fmtDuration(s.durationS)}</td>}
                  <td className="num">{fmtCurrency(s.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <WidgetListMore ref={footerRef} shown={visibleCount} total={topSessions.length} />
        </>
      )}
    </div>
  )
}

export function agentTopSessionsWidget(t: T, data: OverviewResponse): WidgetDef {
  const { topSessions } = data.agentTelemetry
  return {
    id: 'agent-top-sessions',
    title: t('agents.topSessions.title'),
    description: t('agents.topSessions.desc'),
    category: 'table',
    section: 'agents',
    // Ordered from smallest to largest; the picker auto-selects the
    // largest that fits the target slot. Compact 2×2 variant shows
    // just 2-3 top rows, full 4×4 shows 12 with all columns.
    sizes: [{ w: 2, h: 2 }, { w: 2, h: 3 }, { w: 3, h: 3 }, { w: 4, h: 3 }, { w: 4, h: 4 }],
    minW: 2,
    minH: 2,
    render: ({ w }) => (
      <div className="panel widget-panel">
        <PanelHeader
          title={t('agents.topSessions.title')}
          sub={t('agents.topSessions.sub')}
        />
        <TopSessionsBody topSessions={topSessions} w={w} />
      </div>
    ),
  }
}
