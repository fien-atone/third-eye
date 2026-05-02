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

/** One cell in the matrix. Cell background scales in opacity with
 *  the percentage — heatmap style — so a wide cell with a tiny %
 *  doesn't have a "stretched bar" mismatch. The cap on opacity
 *  keeps text readable even for 100% cells. Numeric value is shown
 *  flat in the centre; full breakdown lives in the title attr. */
function ToolCell({ count, total }: { count: number; total: number }) {
  if (count <= 0 || total <= 0) {
    return <td className="num" style={{ color: 'var(--text-dim)', opacity: 0.4 }}>—</td>
  }
  const pct = (count / total) * 100
  // Opacity at 100% should top out at ~55% so the cell tints
  // strongly but text still passes contrast. Linear scaling.
  const tint = Math.min(55, pct * 0.55)
  return (
    <td className="num"
        title={`${fmtInt(count)} / ${fmtInt(total)} = ${pct.toFixed(1)}%`}
        style={{
          background: `color-mix(in srgb, var(--accent) ${tint}%, transparent)`,
          fontSize: 11,
          fontWeight: 500,
        }}>
      {pct.toFixed(0)}%
    </td>
  )
}

/** Truncate a long tool name to keep column headers tight; the
 *  full name remains in the column's title attribute.
 *
 *  MCP tools follow the convention `mcp__<server>__<tool>` where
 *  both <server> and <tool> may themselves contain single
 *  underscores ("ccd_session", "mark_chapter"). Splitting on the
 *  double-underscore separator extracts the leaf tool name
 *  reliably; a regex that treats _ as a delimiter would break on
 *  these. Examples:
 *    mcp__ccd_session__mark_chapter   → mcp:mark_chapter
 *    mcp__pandoc__convert             → mcp:convert
 *    mcp__a__b__c__d                  → mcp:d   (last segment) */
function shortToolName(name: string, maxLen = 14): string {
  if (name.startsWith('mcp__')) {
    const parts = name.split('__')
    if (parts.length >= 3) {
      const leaf = parts[parts.length - 1]
      // Still might be too long after mcp:-prefix removal —
      // truncate the leaf if so.
      const candidate = `mcp:${leaf}`
      return candidate.length <= maxLen ? candidate : candidate.slice(0, maxLen - 1) + '…'
    }
  }
  if (name.length <= maxLen) return name
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
          help={t('agents.toolSpectrum.help')}
        />
        <SpectrumBody topTools={topTools} roles={roles} w={w} />
      </div>
    ),
  }
}
