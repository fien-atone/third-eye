/**
 * Agent tool spectrum — matrix view of "which tools each role uses
 * the most, in what proportion". Answers the universal question
 * "when my <role> agents run, what work do they actually do?".
 *
 * Layout: rows = effective roles (registered + enabled), columns =
 * top-N most-used tools across this project (set by the server).
 * Each cell shows a horizontal mini-bar scaled to the role's tool
 * call count, with the percentage of the role's total tool calls
 * as the label. Native title attribute carries the absolute count
 * for hover-disclosure.
 *
 * Adaptive columns by tile width — the tool list shortens on
 * narrow tiles to keep cells legible:
 *   w=2 → role + top 2 tools
 *   w=3 → role + top 4 tools
 *   w=4 → role + top 6 tools
 *   w≥5 → role + all top 8 tools
 */

import { useRef } from 'react'
import type { WidgetDef } from '../grid'
import type { T } from '../../i18n'
import type { OverviewResponse, AgentTelemetry } from '../../types'
import { ChartEmpty, PanelHeader, WidgetListMore } from '../../components/widgets-misc'
import { fmtInt } from '../../lib/format'
import { useFitCount } from '../../lib/use-fit-count'
import { useT } from '../../i18n'

/** Compact role label — same orange-pill treatment used by the
 *  Distribution widget for visual consistency between the two. */
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
      whiteSpace: 'nowrap',
    }}>
      {name}
    </span>
  )
}

/** One cell in the matrix. The bar fill scales linearly to the
 *  percentage; the inline number is the percentage text. */
function ToolCell({ count, total }: { count: number; total: number }) {
  if (count <= 0 || total <= 0) {
    return <td className="num" style={{ color: 'var(--text-dim)', opacity: 0.4 }}>—</td>
  }
  const pct = (count / total) * 100
  return (
    <td className="num" title={`${fmtInt(count)} / ${fmtInt(total)} = ${pct.toFixed(1)}%`}
        style={{ position: 'relative', verticalAlign: 'middle' }}>
      <div style={{
        position: 'absolute', left: 4, right: 4, top: '50%', height: 4,
        transform: 'translateY(-50%)',
        background: 'color-mix(in srgb, var(--accent) 18%, transparent)',
        borderRadius: 2,
      }}>
        <div style={{
          height: '100%',
          width: `${Math.max(2, pct)}%`,
          background: 'var(--accent)',
          opacity: 0.85,
          borderRadius: 2,
        }} />
      </div>
      <span style={{ position: 'relative', fontSize: 11, fontWeight: 500 }}>
        {pct.toFixed(0)}%
      </span>
    </td>
  )
}

/** Truncate a long tool name (MCP names like
 *  "mcp__ccd_session__mark_chapter") to keep column headers tight.
 *  Full name is preserved in the column's title attribute. */
function shortToolName(name: string, maxLen = 14): string {
  if (name.length <= maxLen) return name
  // mcp__server__tool → mcp:tool (strip the server segment)
  const mcp = name.match(/^mcp__[^_]+(?:__[^_]+)*__([^_]+)$/)
  if (mcp) return `mcp:${mcp[1]}`
  return name.slice(0, maxLen - 1) + '…'
}

function SpectrumBody({ topTools, roles, w }: {
  topTools: string[]
  roles: AgentTelemetry['toolSpectrum']['roles']
  w: number
}) {
  const t = useT()
  const bodyRef = useRef<HTMLDivElement>(null)
  const footerRef = useRef<HTMLDivElement>(null)
  const visibleCount = useFitCount(bodyRef, roles.length, {
    rowSelector: 'tbody > tr',
    reserveBottom: 36,
    footerRef,
  })

  // How many tool columns we render at this width. Cells need
  // ~62 px each to stay readable; everything beyond the cap goes
  // into a residual "Other" column.
  const colsFor = (w: number): number => w <= 2 ? 2 : w <= 3 ? 4 : w <= 4 ? 6 : 8
  const visibleTools = topTools.slice(0, colsFor(w))
  const hiddenTools = topTools.slice(colsFor(w))

  return (
    <div className="widget-panel-body widget-panel-body-fit" ref={bodyRef}>
      {roles.length === 0 ? (
        <ChartEmpty hint={t('agents.toolSpectrum.empty')} />
      ) : (
        <>
          <table className="breakdown" style={{ width: '100%' }}>
            <colgroup>
              <col style={{ width: 130 }} />
              {visibleTools.map((tool) => <col key={tool} style={{ width: 70 }} />)}
              {hiddenTools.length > 0 && <col style={{ width: 60 }} />}
            </colgroup>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>{t('agents.toolSpectrum.colRole')}</th>
                {visibleTools.map(tool => (
                  <th key={tool} className="num" title={tool} style={{ fontSize: 10, fontWeight: 500 }}>
                    {shortToolName(tool)}
                  </th>
                ))}
                {hiddenTools.length > 0 && (
                  <th className="num" title={hiddenTools.join(', ')} style={{ fontSize: 10, fontWeight: 500 }}>
                    {t('agents.toolSpectrum.colOther')}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {roles.slice(0, visibleCount).map(r => {
                const otherCount = hiddenTools.reduce((s, tool) => s + (r.tools[tool] ?? 0), 0)
                return (
                  <tr key={r.role}>
                    <td><AgentBadge name={r.role} /></td>
                    {visibleTools.map(tool => (
                      <ToolCell key={tool} count={r.tools[tool] ?? 0} total={r.toolUses} />
                    ))}
                    {hiddenTools.length > 0 && <ToolCell count={otherCount} total={r.toolUses} />}
                  </tr>
                )
              })}
            </tbody>
          </table>
          <WidgetListMore ref={footerRef} shown={visibleCount} total={roles.length} />
        </>
      )}
    </div>
  )
}

export function agentToolSpectrumWidget(t: T, data: OverviewResponse): WidgetDef {
  const { topTools, roles } = data.agentTelemetry.toolSpectrum
  return {
    id: 'agent-tool-spectrum',
    title: t('agents.toolSpectrum.title'),
    description: t('agents.toolSpectrum.desc'),
    category: 'table',
    section: 'agents',
    sizes: [{ w: 3, h: 2 }, { w: 4, h: 3 }, { w: 6, h: 3 }],
    minW: 2,
    minH: 2,
    render: ({ w }) => (
      <div className="panel widget-panel">
        <PanelHeader
          title={t('agents.toolSpectrum.title')}
          sub={t('agents.toolSpectrum.sub')}
        />
        <SpectrumBody topTools={topTools} roles={roles} w={w} />
      </div>
    ),
  }
}
