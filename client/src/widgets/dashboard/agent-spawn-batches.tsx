/**
 * Agent spawn batches — when Claude dispatches multiple subagents
 * in one orchestration call (Plan mode rollouts, parallel research
 * fan-outs, simulation ticks), they all share the same promptId.
 * This widget surfaces those parallel waves so the user can see
 * "Claude just fanned out 60 agents in one call" patterns.
 *
 * Solo Task() invocations get unique promptIds and are excluded
 * (HAVING > 1 in the SQL). Header shows aggregate batch stats; the
 * body lists the largest batches with role mix and timestamp.
 *
 * Adaptive columns by tile width:
 *   w=2 → Size · When · Cost
 *   w≥3 → + Roles column (most-frequent roles in the batch)
 *   w≥4 → + Tokens column
 */

import { useRef } from 'react'
import type { WidgetDef } from '../grid'
import type { T } from '../../i18n'
import type { OverviewResponse, AgentTelemetry } from '../../types'
import { ChartEmpty, PanelHeader, WidgetListMore } from '../../components/widgets-misc'
import { fmtCurrency, fmtInt, fmtTokens } from '../../lib/format'
import { useFitCount } from '../../lib/use-fit-count'
import { useT } from '../../i18n'

function RoleChip({ name, sessions }: { name: string; sessions: number }) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'baseline',
      padding: '0px 6px',
      borderRadius: 3,
      fontSize: 10,
      fontWeight: 500,
      background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
      color: 'var(--accent)',
      whiteSpace: 'nowrap',
      gap: 3,
    }}>
      <span>{name}</span>
      <span style={{ fontWeight: 400, opacity: 0.7 }}>×{sessions}</span>
    </span>
  )
}

/** Compact relative date — "12d ago" / "3h ago". The full ISO is
 *  in the title attribute on the parent cell for hover-disclosure. */
function relTime(iso: string): string {
  const t = new Date(iso).getTime()
  const diff = Date.now() - t
  if (diff < 60_000) return 'just now'
  const min = Math.floor(diff / 60_000)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const dy = Math.floor(hr / 24)
  if (dy < 30) return `${dy}d ago`
  const mo = Math.floor(dy / 30)
  return `${mo}mo ago`
}

function BatchesBody({ batches, w }: {
  batches: AgentTelemetry['spawnBatches']['batches']
  w: number
}) {
  const t = useT()
  const bodyRef = useRef<HTMLDivElement>(null)
  const footerRef = useRef<HTMLDivElement>(null)
  const visibleCount = useFitCount(bodyRef, batches.length, {
    rowSelector: 'tbody > tr',
    reserveBottom: 36,
    footerRef,
  })
  return (
    <div className="widget-panel-body widget-panel-body-fit" ref={bodyRef}>
      {batches.length === 0 ? (
        <ChartEmpty hint={t('agents.spawnBatches.empty')} />
      ) : (
        <>
          <table className="breakdown" style={{ width: '100%' }}>
            <colgroup>
              <col style={{ width: 56 }} />
              <col style={{ width: 80 }} />
              {w >= 3 && <col />}
              {w >= 4 && <col style={{ width: 80 }} />}
              <col style={{ width: 80 }} />
            </colgroup>
            <thead>
              <tr>
                <th className="num">{t('agents.spawnBatches.colSize')}</th>
                <th>{t('agents.spawnBatches.colWhen')}</th>
                {w >= 3 && <th>{t('agents.spawnBatches.colRoles')}</th>}
                {w >= 4 && <th className="num">{t('agents.spawnBatches.colTokens')}</th>}
                <th className="num">{t('agents.spawnBatches.colCost')}</th>
              </tr>
            </thead>
            <tbody>
              {batches.slice(0, visibleCount).map(b => (
                <tr key={b.promptId}>
                  <td className="num" style={{ fontWeight: 600 }}>{b.size}</td>
                  <td title={b.spawnedAt} style={{ color: 'var(--text-dim)', fontSize: 11 }}>
                    {relTime(b.spawnedAt)}
                  </td>
                  {w >= 3 && (
                    <td style={{
                      maxWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }} title={b.roles.map(r => `${r.role} ×${r.sessions}`).join(', ')}>
                      <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'nowrap' }}>
                        {b.roles.slice(0, 3).map(r => (
                          <RoleChip key={r.role} name={r.role} sessions={r.sessions} />
                        ))}
                        {b.roles.length > 3 && (
                          <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                            +{b.roles.length - 3}
                          </span>
                        )}
                      </span>
                    </td>
                  )}
                  {w >= 4 && <td className="num">{fmtTokens(b.tokens)}</td>}
                  <td className="num">{fmtCurrency(b.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <WidgetListMore ref={footerRef} shown={visibleCount} total={batches.length} />
        </>
      )}
    </div>
  )
}

export function agentSpawnBatchesWidget(t: T, data: OverviewResponse): WidgetDef {
  const sb = data.agentTelemetry.spawnBatches
  // Subtitle: aggregate batch stats. With no batches at all we
  // skip them — empty table message will say everything.
  const sub = sb.batchCount > 0
    ? t('agents.spawnBatches.subFmt', {
        count: fmtInt(sb.batchCount),
        avg: sb.avgSize.toFixed(1),
        max: fmtInt(sb.maxSize),
      })
    : t('agents.spawnBatches.subEmpty')
  return {
    id: 'agent-spawn-batches',
    title: t('agents.spawnBatches.title'),
    description: t('agents.spawnBatches.desc'),
    category: 'table',
    section: 'agents',
    sizes: [{ w: 2, h: 2 }, { w: 3, h: 3 }, { w: 4, h: 3 }, { w: 6, h: 3 }],
    minW: 2,
    minH: 2,
    render: ({ w }) => (
      <div className="panel widget-panel">
        <PanelHeader
          title={t('agents.spawnBatches.title')}
          sub={sub}
          help={t('agents.spawnBatches.help')}
        />
        <BatchesBody batches={sb.batches} w={w} />
      </div>
    ),
  }
}
