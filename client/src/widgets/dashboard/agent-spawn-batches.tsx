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
 * Column order — same at every width: When · Role · Size · [Tokens] · Cost.
 * Reading flow matches how a user thinks about a batch: "I want to
 * see WHEN something fanned out, WHAT roles, HOW MANY, COST". Tokens
 * shown only on wide tiles (w≥4) since they're a secondary metric.
 * Role names stay visible at every width — that's the primary signal,
 * hiding it on narrow tiles defeats the purpose of the widget.
 */

import { useRef } from 'react'
import { format, parseISO } from 'date-fns'
import type { WidgetDef } from '../grid'
import type { T } from '../../i18n'
import type { OverviewResponse, AgentTelemetry } from '../../types'
import { ChartEmpty, PanelHeader, WidgetListMore } from '../../components/widgets-misc'
import { fmtCurrency, fmtInt, fmtTokens, useDateLocale } from '../../lib/format'
import { useFitCount } from '../../lib/use-fit-count'
import { useT } from '../../i18n'

/** Role chip. The "×N" multiplier shows per-role count within the
 *  batch — but it's redundant when the batch is single-role (the
 *  Size column already carries that number). Caller passes
 *  `showMultiplier=false` in that case to drop the noise. */
function RoleChip({ name, sessions, showMultiplier }: {
  name: string; sessions: number; showMultiplier: boolean
}) {
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
      {showMultiplier && <span style={{ fontWeight: 400, opacity: 0.7 }}>×{sessions}</span>}
    </span>
  )
}

/** Concrete date + time for batch dispatch. Showed "12d ago" before,
 *  but for orchestration analysis the actual moment matters more
 *  than fuzzy distance — comparing two batches that both say "5d
 *  ago" doesn't help; "2 May 14:34" vs "27 Apr 09:12" does. The
 *  parent cell carries the full ISO in title= for the day-of-week
 *  / seconds disclosure. */
function useFmtBatchTime() {
  const dl = useDateLocale()
  // Visible cell: "10 Apr, 13:09" — concrete enough to compare
  // batches at a glance, narrow enough not to push the table.
  const cell = (iso: string) => format(parseISO(iso), 'd MMM, HH:mm', { locale: dl })
  // title= attribute on hover: full date + day-of-week + seconds.
  // Keeping the seconds since we have promptIds to disambiguate
  // batches dispatched in the same minute (rare, but possible).
  const tooltip = (iso: string) => format(parseISO(iso), 'EEEE, d MMM yyyy · HH:mm:ss', { locale: dl })
  return { cell, tooltip }
}

function BatchesBody({ batches, w }: {
  batches: AgentTelemetry['spawnBatches']['batches']
  w: number
}) {
  const t = useT()
  const { cell: fmtCell, tooltip: fmtTooltip } = useFmtBatchTime()
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
              <col style={{ width: 90 }} />     {/* When */}
              <col />                            {/* Role(s) — flex */}
              <col style={{ width: 38 }} />     {/* Size */}
              {w >= 4 && <col style={{ width: 70 }} />}  {/* Tokens (wide only) */}
              <col style={{ width: 64 }} />     {/* Cost */}
            </colgroup>
            <thead>
              <tr>
                <th>{t('agents.spawnBatches.colWhen')}</th>
                <th>{t('agents.spawnBatches.colRoles')}</th>
                <th className="num">{t('agents.spawnBatches.colSize')}</th>
                {w >= 4 && <th className="num">{t('agents.spawnBatches.colTokens')}</th>}
                <th className="num">{t('agents.spawnBatches.colCost')}</th>
              </tr>
            </thead>
            <tbody>
              {batches.slice(0, visibleCount).map(b => (
                <tr key={b.promptId}>
                  <td title={fmtTooltip(b.spawnedAt)} style={{ color: 'var(--text-dim)', fontSize: 11, whiteSpace: 'nowrap' }}>
                    {fmtCell(b.spawnedAt)}
                  </td>
                  <td style={{
                    maxWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }} title={b.roles.map(r => `${r.role} ×${r.sessions}`).join(', ')}>
                    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'nowrap' }}>
                      {b.roles.slice(0, 3).map(r => (
                        <RoleChip
                          key={r.role}
                          name={r.role}
                          sessions={r.sessions}
                          // Hide the ×N suffix for single-role batches —
                          // it just repeats the Size column. Show it
                          // for mixed-role batches where the breakdown
                          // is the actual signal.
                          showMultiplier={b.roles.length > 1}
                        />
                      ))}
                      {b.roles.length > 3 && (
                        <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                          +{b.roles.length - 3}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="num" style={{ fontVariantNumeric: 'tabular-nums' }}>{b.size}</td>
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
