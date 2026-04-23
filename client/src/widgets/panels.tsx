/** Reusable widget panels — chart-heavy components rendered inside
 *  WidgetGrid tiles. Each panel is responsible for its own internal
 *  layout (panel header + chart body filling remaining space). */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  BarChart, Bar, PieChart, Pie, Cell,
} from 'recharts'
import { useT } from '../i18n'
import { COLORS, fmtCurrency, fmtInt, fmtTokens } from '../lib/format'
import { useFitCount } from '../lib/use-fit-count'
import {
  ChartEmpty, DateCell, HelpTip, PanelHeader, WidgetListMore,
} from '../components/widgets-misc'
import {
  SeriesTooltip, CallsTooltip, TokenTooltip, ProjectSeriesTooltip, VersionTooltip,
} from './tooltips'
import type { Granularity, InsightsItem, OverviewResponse, VersionRow } from '../types'

// ─── Project-pill compact label ───────────────────────────────────────

/** Compact label for inline pills. Path-aware:
 *  ~/Desktop/Inoise/Global/TTRPG/app  →  TTRPG/app
 *  ~/Desktop/Inoise/Global/dnd/character/builder  →  character/builder
 *  long Cowork prompt text...  →  first ~22 chars + ellipsis */
export function compactProjectLabel(label: string, max = 24): string {
  if (/[/\\]/.test(label)) {
    const parts = label.split(/[/\\]+/).filter(Boolean)
    const tail = parts.length >= 2 ? parts.slice(-2).join('/') : (parts[0] ?? label)
    return tail.length <= max ? tail : tail.slice(0, max - 1).trimEnd() + '…'
  }
  return label.length <= max ? label : label.slice(0, max - 1).trimEnd() + '…'
}

// ─── CostByProjectPanel — stacked bars per project + pill legend ─────

export function CostByProjectPanel({
  series, topProjects, otherProjects, granularity, hasData, onSelectProject, showLegend = true,
}: {
  series: Array<Record<string, number | string>>
  topProjects: OverviewResponse['topProjects']
  otherProjects: OverviewResponse['otherProjects']
  granularity: Granularity
  hasData: boolean
  onSelectProject: (key: string) => void
  showLegend?: boolean
}) {
  const t = useT()
  const entries = topProjects.map((p, i) => ({
    dataKey: `project:${p.key}`,
    label: p.label,
    projectKey: p.key,
    projectId: p.id,
    cost: p.cost,
    color: COLORS[i % COLORS.length],
  }))
  if (otherProjects.count > 0) {
    entries.push({
      dataKey: 'project:__other',
      label: t('panel.costByProject.other'),
      projectKey: '',
      projectId: null,
      cost: otherProjects.cost,
      color: 'var(--text-dim)',
    })
  }

  return (
    <div className="panel widget-panel">
      <PanelHeader
        title={t('panel.costByProject.title')}
        sub={t(granularity === 'day' ? 'panel.costByProject.subDay' : granularity === 'week' ? 'panel.costByProject.subWeek' : 'panel.costByProject.subMonth')}
        help={t('panel.costByProject.help')}
      />
      <div className="widget-panel-body widget-chart-body">
      {!hasData || entries.length === 0 ? (
        <ChartEmpty />
      ) : (
        <>
          {showLegend && (
            <div className="activity-pills widget-chart-legend" role="list">
              {entries.map(e => {
                const isOther = e.dataKey === 'project:__other'
                const clickable = !isOther && !!e.projectKey
                const shortLabel = isOther
                  ? t('panel.costByProject.other')
                  : compactProjectLabel(e.label)
                const fullTitle = isOther
                  ? t('panel.costByProject.otherWith', { count: otherProjects.count })
                  : `${e.label} · ${fmtCurrency(e.cost)}`
                return (
                  <button
                    key={e.dataKey}
                    role="listitem"
                    className={`activity-pill${clickable ? ' clickable' : ''}`}
                    onClick={clickable ? () => onSelectProject(e.projectKey) : undefined}
                    disabled={!clickable}
                    title={fullTitle}
                  >
                    <span className="pill-dot" style={{ background: e.color }} />
                    <span className="pill-label">{shortLabel}</span>
                  </button>
                )
              })}
            </div>
          )}
          <div className="widget-chart-area">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={series} margin={TIMESERIES_MARGIN} barCategoryGap="15%">
                <CartesianGrid stroke="var(--grid)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="_label" tickLine={false} axisLine={{ stroke: 'var(--grid)' }} interval="preserveStartEnd" />
                <YAxis tickLine={false} axisLine={{ stroke: 'var(--grid)' }} tickFormatter={v => `$${v}`} width={TIMESERIES_YAXIS_WIDTH} />
                <Tooltip content={<ProjectSeriesTooltip entries={entries} />} cursor={{ fill: 'var(--hover)' }} animationDuration={0} isAnimationActive={false} />
                {entries.map((e, i) => {
                  const isLast = i === entries.length - 1
                  return (
                    <Bar
                      key={e.dataKey}
                      dataKey={e.dataKey}
                      name={e.label}
                      stackId="cost"
                      fill={e.color}
                      radius={isLast ? [3, 3, 0, 0] : 0}
                      isAnimationActive={false}
                    />
                  )
                })}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
      </div>
    </div>
  )
}

// ─── TokensPanel — input/output/cache toggle ──────────────────────────

type TokenView = 'all' | 'io' | 'cache'

export function TokensPanel({ series, granularity: _g, hasData, showLegend = true }: { series: Array<Record<string, number | string>>; granularity: Granularity; hasData: boolean; showLegend?: boolean }) {
  const t = useT()
  const [view, setView] = useState<TokenView>('all')
  const showIO = view === 'all' || view === 'io'
  const showCache = view === 'all' || view === 'cache'
  const bars: Array<{ key: string; name: string; color: string }> = []
  if (showCache) {
    bars.push({ key: 'cacheRead', name: `${t('kpi.cache')} ${t('kpi.read').toLowerCase()}`, color: 'var(--chart-2)' })
    bars.push({ key: 'cacheWrite', name: `${t('kpi.cache')} ${t('kpi.write').toLowerCase()}`, color: 'var(--chart-4)' })
  }
  if (showIO) {
    bars.push({ key: 'outputTokens', name: t('kpi.output'), color: 'var(--chart-1)' })
    bars.push({ key: 'inputTokens', name: t('kpi.input'), color: 'var(--chart-3)' })
  }
  // Hide the view-filter chips when the widget is too narrow to fit
  // them next to the title. Force the underlying view back to "all" so
  // the chart shows everything (otherwise the user could be stuck on a
  // filtered view they can't change). Threshold (~360px) covers w=1/2
  // on a typical dashboard width; w=3+ shows the chips as before.
  const panelRef = useRef<HTMLDivElement>(null)
  const panelW = useElementWidth(panelRef)
  const showFilters = panelW === 0 || panelW >= 360
  useEffect(() => {
    if (!showFilters && view !== 'all') setView('all')
  }, [showFilters, view])
  const effectiveView: TokenView = showFilters ? view : 'all'
  const effectiveBars: Array<{ key: string; name: string; color: string }> = []
  if (effectiveView === 'all' || effectiveView === 'cache') {
    effectiveBars.push({ key: 'cacheRead', name: `${t('kpi.cache')} ${t('kpi.read').toLowerCase()}`, color: 'var(--chart-2)' })
    effectiveBars.push({ key: 'cacheWrite', name: `${t('kpi.cache')} ${t('kpi.write').toLowerCase()}`, color: 'var(--chart-4)' })
  }
  if (effectiveView === 'all' || effectiveView === 'io') {
    effectiveBars.push({ key: 'outputTokens', name: t('kpi.output'), color: 'var(--chart-1)' })
    effectiveBars.push({ key: 'inputTokens', name: t('kpi.input'), color: 'var(--chart-3)' })
  }
  return (
    <div className="panel widget-panel" ref={panelRef}>
      <div className="panel-head">
        <div>
          <div className="panel-title-row">
            <h3 style={{ margin: 0 }}>{t('panel.tokens.title')}</h3>
            <HelpTip>
              {t('panel.tokens.help.intro')} <strong>{t('kpi.input')}/{t('kpi.output')}</strong> — {t('panel.tokens.help.io')} <strong>{t('kpi.cache')}</strong> — {t('panel.tokens.help.cache')} {t('panel.tokens.help.tip')}
            </HelpTip>
          </div>
          <span className="panel-sub">{t('panel.tokens.sub')}</span>
        </div>
        {showFilters && (
          <div className="chip-group">
            <button className={`chip${view === 'all' ? ' active' : ''}`} onClick={() => setView('all')}>{t('panel.tokens.both')}</button>
            <button className={`chip${view === 'io' ? ' active' : ''}`} onClick={() => setView('io')}>{t('panel.tokens.ioOnly')}</button>
            <button className={`chip${view === 'cache' ? ' active' : ''}`} onClick={() => setView('cache')}>{t('panel.tokens.cacheOnly')}</button>
          </div>
        )}
      </div>
      <div className="widget-panel-body widget-chart-body">
        {hasData ? (
          <div className="widget-chart-area">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={series} margin={TIMESERIES_MARGIN} barCategoryGap="15%">
                <CartesianGrid stroke="var(--grid)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="_label" tickLine={false} axisLine={{ stroke: 'var(--grid)' }} interval="preserveStartEnd" />
                <YAxis tickLine={false} axisLine={{ stroke: 'var(--grid)' }} tickFormatter={fmtTokens} width={TIMESERIES_YAXIS_WIDTH} />
                <Tooltip content={<TokenTooltip />} cursor={{ fill: 'var(--hover)' }} animationDuration={0} isAnimationActive={false} />
                {showLegend && <Legend wrapperStyle={{ paddingTop: 8 }} iconType="square" />}
                {effectiveBars.map((b, i) => (
                  <Bar
                    key={b.key}
                    dataKey={b.key}
                    name={b.name}
                    stackId="t"
                    fill={b.color}
                    radius={i === effectiveBars.length - 1 ? [3, 3, 0, 0] : 0}
                    isAnimationActive={false}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (<ChartEmpty />)}
      </div>
    </div>
  )
}

// Shared layout constants for time-series widgets so that two widgets
// of the same size stack visually aligned: same Y-axis gutter, same
// chart-body margins. Identical x-axis tick density falls out
// automatically when the data shape (granularity) matches.
export const TIMESERIES_MARGIN = { top: 8, right: 16, left: 0, bottom: 8 } as const
export const TIMESERIES_YAXIS_WIDTH = 60

// ─── ModelsPanel — sortable models table with adaptive row count ─────

// Models columns ordered by drop priority (last entries drop first when
// the widget is too narrow). Each tier specifies the minimum widget body
// width (px) below which the column is hidden. Model + Cost are
// always-visible (minWidth: 0).
type ModelCol = 'model' | 'share' | 'calls' | 'input' | 'output' | 'cacheR' | 'cacheW' | 'cost'
const MODELS_COL_ORDER: { id: ModelCol; minWidth: number; cssWidth: string }[] = [
  { id: 'model',  minWidth: 0,   cssWidth: '22%' },
  { id: 'cost',   minWidth: 0,   cssWidth: '14%' },
  { id: 'calls',  minWidth: 280, cssWidth: '11%' },
  { id: 'share',  minWidth: 360, cssWidth: '24%' },
  { id: 'input',  minWidth: 480, cssWidth: '10%' },
  { id: 'output', minWidth: 560, cssWidth: '10%' },
  { id: 'cacheR', minWidth: 720, cssWidth: '11%' },
  { id: 'cacheW', minWidth: 820, cssWidth: '11%' },
]

function useElementWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(el)
    setW(el.clientWidth)
    return () => ro.disconnect()
  }, [ref])
  return w
}

export function ModelsPanel({ data }: { data: OverviewResponse }) {
  const t = useT()
  const totalCost = data.totals.cost
  const totalCalls = data.totals.calls
  const maxShare = data.models[0]?.cost ?? 0

  const bodyRef = useRef<HTMLDivElement>(null)
  const footerRef = useRef<HTMLDivElement>(null)
  const visibleCount = useFitCount(bodyRef, data.models.length, {
    rowSelector: 'tbody > tr',
    reserveBottom: 36,
    footerRef,
  })
  const bodyWidth = useElementWidth(bodyRef)
  // Render in fixed visual order (model, share, calls, input, output,
  // cacheR, cacheW, cost) but compute visibility via the priority list.
  const visibleCols = new Set(MODELS_COL_ORDER.filter(c => bodyWidth >= c.minWidth).map(c => c.id))
  const VISUAL_ORDER: { id: ModelCol; cssWidth: string }[] = [
    { id: 'model',  cssWidth: '22%' },
    { id: 'share',  cssWidth: '24%' },
    { id: 'calls',  cssWidth: '11%' },
    { id: 'input',  cssWidth: '10%' },
    { id: 'output', cssWidth: '10%' },
    { id: 'cacheR', cssWidth: '11%' },
    { id: 'cacheW', cssWidth: '11%' },
    { id: 'cost',   cssWidth: '14%' },
  ]
  const cols = VISUAL_ORDER.filter(c => visibleCols.has(c.id))

  const headLabel: Record<ModelCol, string> = {
    model:  t('panel.models.colModel'),
    share:  t('panel.models.colShare'),
    calls:  t('panel.models.colCalls'),
    input:  t('panel.models.colInput'),
    output: t('panel.models.colOutput'),
    cacheR: t('panel.models.colCacheR'),
    cacheW: t('panel.models.colCacheW'),
    cost:   t('panel.models.colCost'),
  }

  return (
    <div className="panel widget-panel">
      <PanelHeader
        title={t('panel.models.title')}
        sub={t('panel.models.subFmt', { count: data.models.length, calls: fmtInt(totalCalls), cost: fmtCurrency(totalCost) })}
        help={t('panel.models.help')}
      />
      <div className="widget-panel-body widget-panel-body-fit" ref={bodyRef}>
      {data.models.length === 0 ? <ChartEmpty /> : (
      <>
      <table className="models">
        <colgroup>
          {cols.map(c => <col key={c.id} style={{ width: c.cssWidth }} />)}
        </colgroup>
        <thead>
          <tr>
            {cols.map(c => <th key={c.id}>{headLabel[c.id]}</th>)}
          </tr>
        </thead>
        <tbody>
          {data.models.slice(0, visibleCount).map((m, i) => {
            const share = totalCost > 0 ? (m.cost / totalCost) * 100 : 0
            const barWidth = maxShare > 0 ? (m.cost / maxShare) * 100 : 0
            const color = `var(--chart-${(i % 10) + 1})`
            const cellFor = (c: ModelCol) => {
              switch (c) {
                case 'model':  return <td><span className="model-cell"><span className="swatch" style={{ background: color }} />{m.name}</span></td>
                case 'share':  return <td className="share-cell"><div className="share-bar"><div className="share-fill" style={{ width: `${barWidth}%`, background: color }} /><span className="share-label">{share.toFixed(1)}%</span></div></td>
                case 'calls':  return <td>{fmtInt(m.calls)}</td>
                case 'input':  return <td>{fmtTokens(m.inputTokens)}</td>
                case 'output': return <td>{fmtTokens(m.outputTokens)}</td>
                case 'cacheR': return <td>{fmtTokens(m.cacheRead)}</td>
                case 'cacheW': return <td>{fmtTokens(m.cacheWrite)}</td>
                case 'cost':   return <td style={{ fontWeight: 600 }}>{fmtCurrency(m.cost)}</td>
              }
            }
            return <tr key={m.name}>{cols.map(c => <React.Fragment key={c.id}>{cellFor(c.id)}</React.Fragment>)}</tr>
          })}
        </tbody>
      </table>
      <WidgetListMore ref={footerRef} shown={visibleCount} total={data.models.length} />
      </>
      )}
      </div>
    </div>
  )
}

// ─── InsightsList — compact bar-chart-list (Subagents, Skills, MCP, Bash) ───

export function InsightsList({ title, subtitle, rows, unit, help }: { title: string; subtitle: string; rows: InsightsItem[]; unit: string; help?: React.ReactNode }) {
  const max = Math.max(1, ...rows.map(r => r.count))
  const bodyRef = useRef<HTMLDivElement>(null)
  const footerRef = useRef<HTMLDivElement>(null)
  const visibleCount = useFitCount(bodyRef, rows.length, {
    rowSelector: '.insights-row',
    reserveBottom: 36,
    footerRef,
  })
  return (
    <div className="panel widget-panel">
      <PanelHeader title={title} sub={subtitle} help={help} />
      {rows.length === 0 ? (
        <ChartEmpty height={140} />
      ) : (
        <div className="widget-panel-body widget-panel-body-fit" ref={bodyRef}>
          <div className="insights-list">
            {rows.slice(0, visibleCount).map((r, i) => (
              <div className="insights-row" key={r.name + i}>
                <div className="insights-bar" style={{ width: `${(r.count / max) * 100}%` }} />
                <div className="insights-row-content">
                  <span className="insights-name" title={r.name}>{r.name}</span>
                  <span className="insights-meta">{fmtInt(r.count)} {unit} · {fmtCurrency(r.cost)}</span>
                </div>
              </div>
            ))}
          </div>
          <WidgetListMore ref={footerRef} shown={visibleCount} total={rows.length} />
        </div>
      )}
    </div>
  )
}

// ─── VersionsPanel — Claude Code CLI version distribution ────────────

type VersionMetric = 'cost' | 'calls' | 'tokens'

export function VersionsPanel({ rows }: { rows: VersionRow[] }) {
  const t = useT()
  const [metric, setMetric] = useState<VersionMetric>('cost')
  const fmt = metric === 'cost' ? fmtCurrency : metric === 'calls' ? fmtInt : fmtTokens
  const total = rows.reduce((s, v) => s + (v[metric] ?? 0), 0)
  const sorted = [...rows].sort((a, b) => (b[metric] ?? 0) - (a[metric] ?? 0))
  const pieData = sorted.map(v => ({ name: v.name, value: v[metric] ?? 0 }))
  const metricLabel = metric === 'cost' ? t('insights.versions.metricCost') : metric === 'calls' ? t('insights.versions.metricCalls') : t('insights.versions.metricTokens')

  const panelRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const footerRef = useRef<HTMLDivElement>(null)
  const panelW = useElementWidth(panelRef)
  // Same threshold as TokensPanel — w=1/2 hide chips and force the
  // default metric so a filtered view doesn't get "stuck" on a tile
  // where the user can't change it back.
  const showFilters = panelW === 0 || panelW >= 360
  // Donut takes ~200px on its own; below this width the table on its
  // right gets squashed. Hide the donut and let the table take the
  // full panel width.
  const showDonut = panelW === 0 || panelW >= 460
  useEffect(() => {
    if (!showFilters && metric !== 'cost') setMetric('cost')
  }, [showFilters, metric])
  const effectiveMetric: VersionMetric = showFilters ? metric : 'cost'
  const effectiveFmt = effectiveMetric === 'cost' ? fmtCurrency : effectiveMetric === 'calls' ? fmtInt : fmtTokens
  const effectiveTotal = rows.reduce((s, v) => s + (v[effectiveMetric] ?? 0), 0)
  const effectiveSorted = [...rows].sort((a, b) => (b[effectiveMetric] ?? 0) - (a[effectiveMetric] ?? 0))
  const effectivePie = effectiveSorted.map(v => ({ name: v.name, value: v[effectiveMetric] ?? 0 }))

  // Column priorities for the side table — same drop-by-width strategy
  // as ModelsPanel. Version + metric value are mandatory; share and
  // first-seen drop earliest on narrow tiles.
  const tableW = showDonut ? Math.max(0, panelW - 220) : panelW
  const showShare = tableW === 0 || tableW >= 240
  const showFirstSeen = tableW === 0 || tableW >= 360

  const visibleCount = useFitCount(bodyRef, effectiveSorted.length, {
    rowSelector: 'tbody > tr',
    reserveBottom: 36,
    footerRef,
  })
  const [hoverVersion, setHoverVersion] = useState<string | null>(null)

  return (
    <div className="panel widget-panel" ref={panelRef}>
      <div className="panel-head">
        <div>
          <div className="panel-title-row">
            <h3 style={{ margin: 0 }}>{t('insights.versions.title')}</h3>
            <HelpTip>{t('insights.versions.help')}</HelpTip>
          </div>
          <span className="panel-sub">{t('insights.versions.subFmt', { count: rows.length, value: effectiveFmt(effectiveTotal) })}</span>
        </div>
        {showFilters && (
          <div className="chip-group">
            <button className={`chip${metric === 'cost' ? ' active' : ''}`} onClick={() => setMetric('cost')}>{t('insights.versions.metricCost')}</button>
            <button className={`chip${metric === 'calls' ? ' active' : ''}`} onClick={() => setMetric('calls')}>{t('insights.versions.metricCalls')}</button>
            <button className={`chip${metric === 'tokens' ? ' active' : ''}`} onClick={() => setMetric('tokens')}>{t('insights.versions.metricTokens')}</button>
          </div>
        )}
      </div>
      {rows.length === 0 ? (
        <ChartEmpty height={200} hint={t('insights.versions.empty')} />
      ) : (
        <div className="widget-panel-body widget-panel-body-fit" ref={bodyRef}>
          <div className="versions-layout">
            {showDonut && (
              <div className="versions-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    {/* Percent radii so the donut scales to whatever
                        the .versions-chart cell ends up being — at h=2
                        that's ~100px, at h=3 ~200px. Without this the
                        old fixed 88px outerRadius clipped at h=2 and
                        wasted space at h=3. */}
                    <Pie
                      data={effectivePie}
                      dataKey="value"
                      nameKey="name"
                      innerRadius="55%"
                      outerRadius="92%"
                      paddingAngle={1}
                      isAnimationActive={false}
                      onMouseEnter={(_, i) => setHoverVersion(effectivePie[i]?.name ?? null)}
                      onMouseLeave={() => setHoverVersion(null)}
                    >
                      {effectivePie.map((d, i) => {
                        const dim = hoverVersion !== null && hoverVersion !== d.name
                        return (
                          <Cell
                            key={i}
                            fill={COLORS[i % COLORS.length]}
                            stroke="var(--panel)"
                            strokeWidth={hoverVersion === d.name ? 3 : 2}
                            opacity={dim ? 0.35 : 1}
                          />
                        )
                      })}
                    </Pie>
                    <Tooltip content={<VersionTooltip total={effectiveTotal} fmt={effectiveFmt} />} animationDuration={0} isAnimationActive={false} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
            <div className="versions-table">
              <table className="breakdown breakdown-versions">
                <colgroup>
                  <col />
                  {showShare && <col style={{ width: 70 }} />}
                  <col style={{ width: 90 }} />
                  {showFirstSeen && <col style={{ width: 110 }} />}
                </colgroup>
                <thead>
                  <tr>
                    <th>{t('insights.versions.colVersion')}</th>
                    {showShare && <th className="num">{t('insights.versions.colShare')}</th>}
                    <th className="num">{metricLabel}</th>
                    {showFirstSeen && <th className="num">{t('insights.versions.colFirstSeen')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {effectiveSorted.slice(0, visibleCount).map((v, i) => {
                    const pct = effectiveTotal > 0 ? ((v[effectiveMetric] ?? 0) / effectiveTotal) * 100 : 0
                    const isHover = hoverVersion === v.name
                    return (
                      <tr
                        key={v.name}
                        className={isHover ? 'is-hover' : ''}
                        onMouseEnter={() => setHoverVersion(v.name)}
                        onMouseLeave={() => setHoverVersion(prev => (prev === v.name ? null : prev))}
                      >
                        <td>
                          <span className="swatch" style={{ background: `var(--chart-${(i % 10) + 1})` }} />
                          <span style={{ fontFamily: 'ui-monospace, monospace' }}>{v.name}</span>
                        </td>
                        {showShare && <td className="num">{pct.toFixed(1)}%</td>}
                        <td className="num">{effectiveFmt(v[effectiveMetric] ?? 0)}</td>
                        {showFirstSeen && <td className="num"><DateCell value={v.first_ts} /></td>}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <WidgetListMore ref={footerRef} shown={visibleCount} total={effectiveSorted.length} />
        </div>
      )}
    </div>
  )
}

// Re-export for SeriesTooltip etc usage from outside (calls/cost-by-model
// charts are still inline in the dashboard catalog — they import these).
export { SeriesTooltip, CallsTooltip, TokenTooltip, ProjectSeriesTooltip, VersionTooltip }
