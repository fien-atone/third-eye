/**
 * Chart: Codex / ChatGPT plan-usage history.
 *
 * Daily peak 5h-window utilization (the "you're going to get rate-
 * limited" metric) over the dashboard's date range. Each day = one
 * stacked bar, with a colored segment per `plan_type` that was active
 * that day:
 *   - Single-plan day → one segment, bar height = peak primary %.
 *   - Multi-plan day  → stacked segments (free + plus + …), each
 *                       colored by plan, height = that plan's peak.
 *                       Total may exceed 100% — that's fine, it
 *                       reads as "intense day across multiple plans".
 *
 * The 7d secondary window is overlaid as a smooth line on top of the
 * bars. Semantically it's a slow-moving cumulative metric (rolling
 * 7-day cap), so a continuous line reads as "where you are on the
 * weekly meter" — distinct from the discrete day-by-day spikes that
 * the bars show.
 *
 * Visibility:
 *   - Only on the Dashboard screen (`screens: ['dashboard']`). Today
 *     is single-day (uses the snapshot KPI); Project view filters by
 *     project but rate_limits are account-wide, so a per-project
 *     trajectory would be identical regardless of selection.
 *   - Hidden until the server includes `codexPlanHistory` (multi-day
 *     range AND scope contains Codex calls).
 */

import type { Locale } from 'date-fns'
import { ComposedChart, Bar, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import type { WidgetDef } from '../grid'
import type { T } from '../../i18n'
import type { Granularity, OverviewResponse } from '../../types'
import { ChartEmpty, PanelHeader } from '../../components/widgets-misc'
import { TIMESERIES_MARGIN, TIMESERIES_YAXIS_WIDTH } from '../panels'
import { formatBucket, formatBucketFull } from '../../screens/dashboard'

type Row = NonNullable<OverviewResponse['codexPlanHistory']>[number]
// One Recharts row per bucket (day/week/month — driven by dashboard
// granularity). byPlan is flattened into top-level keys
// (`plan_free`, `plan_plus`, …) so each plan can be a separate <Bar>
// with its own stackId. We can't union the typed fields with a
// `Record<string, …>` index signature directly — `_row: Row` would
// fail to satisfy a number/string/null index — so the dynamic
// plan_* keys live as a parallel any-shape map. Recharts only reads
// fields by string key, so it doesn't care how strict the type is.
type ChartRow = {
  _label: string
  _labelFull: string
  _row: Row
  // _secondary is null on empty buckets so Recharts breaks the line
  // across gaps instead of dragging it down to 0.
  _secondary: number | null
  // Dynamic per-plan stack values (`plan_free`, `plan_plus`, …).
  [planKey: `plan_${string}`]: number
}

const PLAN_KEY_PREFIX = 'plan_'

/** Display order + color palette for known OpenAI plan types. Anything
 *  unrecognised falls back to 'unknown' at the end. The CSS variables
 *  reuse the existing chart palette so the widget plays well with both
 *  light and dark themes. */
const PLAN_PALETTE: Record<string, { color: string; label: (t: T) => string }> = {
  free:    { color: 'var(--chart-3)', label: t => t('codexPlan.planFree') },
  plus:    { color: 'var(--chart-1)', label: () => 'Plus' },
  pro:     { color: 'var(--chart-2)', label: () => 'Pro' },
  go:      { color: 'var(--chart-4)', label: () => 'Go' },
  enterprise: { color: 'var(--chart-5, #8b5cf6)', label: () => 'Enterprise' },
  edu:     { color: 'var(--chart-6, #14b8a6)', label: () => 'Edu' },
  unknown: { color: 'var(--grid)', label: t => t('codexPlan.unknown') },
}

const PLAN_ORDER = ['free', 'plus', 'pro', 'go', 'enterprise', 'edu', 'unknown']

function fmtPct(v: number): string {
  return `${v.toFixed(0)}%`
}

function planLabel(plan: string, t: T): string {
  const known = PLAN_PALETTE[plan]
  if (known) return known.label(t)
  return plan.charAt(0).toUpperCase() + plan.slice(1)
}

function planColor(plan: string): string {
  return (PLAN_PALETTE[plan] ?? PLAN_PALETTE.unknown).color
}

function CodexPlanHistoryTooltip({ active, payload, t }: { active?: boolean; payload?: Array<{ payload: ChartRow }>; t: T }) {
  if (!active || !payload || payload.length === 0) return null
  const cr = payload[0].payload
  const r = cr._row
  const plans = Object.entries(r.byPlan).sort((a, b) => b[1] - a[1])
  const hasAnyData = plans.length > 0 || r.secondaryPct !== null
  return (
    <div className="recharts-tooltip-fallback" style={{ background: 'var(--surface)', border: '1px solid var(--grid)', padding: 8, fontSize: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{cr._labelFull}</div>
      {!hasAnyData && (
        <div style={{ color: 'var(--muted)' }}>{t('codexPlanHistory.noDataDay')}</div>
      )}
      {plans.map(([plan, pct]) => (
        <div key={plan} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ display: 'inline-block', width: 8, height: 8, background: planColor(plan), borderRadius: 2 }} />
          <span>{planLabel(plan, t)}: <strong>{fmtPct(pct)}</strong></span>
        </div>
      ))}
      {r.secondaryPct !== null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
          <span style={{ display: 'inline-block', width: 12, height: 0, borderTop: '2px dashed var(--text)' }} />
          <span>{t('codexPlanHistory.secondaryName')}: <strong>{fmtPct(r.secondaryPct)}</strong></span>
        </div>
      )}
      {r.creditsExhausted && (
        <div style={{ color: 'var(--danger, #c33)', marginTop: 4 }}>
          {t('codexPlan.creditsExhausted')}
        </div>
      )}
    </div>
  )
}

export function codexPlanHistoryWidget(t: T, data: OverviewResponse, granularity: Granularity, dl: Locale): WidgetDef {
  const history = data.codexPlanHistory ?? []
  const hasData = history.length > 0

  // Collect all plan_types that show up across the range so we know
  // which <Bar> series to render. Sorted by canonical plan order so
  // the legend reads predictably.
  const seenPlans = new Set<string>()
  for (const r of history) {
    for (const p of Object.keys(r.byPlan)) seenPlans.add(p)
  }
  const planList = [...seenPlans].sort((a, b) => {
    const ai = PLAN_ORDER.indexOf(a)
    const bi = PLAN_ORDER.indexOf(b)
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
  })

  // Flatten each row's byPlan into top-level keyed fields. Recharts
  // <Bar dataKey="plan_free" /> reads the segment height from this.
  // _secondary feeds the overlay line that tracks the 7d-window peak.
  // Labels come from formatBucket (axis-compact) / formatBucketFull
  // (tooltip-readable, includes year + weekday) — same helpers other
  // time-series widgets use, so granularity changes flow uniformly.
  const chartRows: ChartRow[] = history.map(r => {
    const out: ChartRow = {
      _label: formatBucket(r.bucket, granularity, dl),
      _labelFull: formatBucketFull(r.bucket, granularity, dl),
      _row: r,
      _secondary: r.secondaryPct,
    }
    for (const p of planList) {
      // The template-literal key type narrows to `plan_${string}` at
      // the type level; the runtime concat gives us the matching key
      // but TS sees a generic `string`. Cast at the assignment site.
      ;(out as unknown as Record<string, number>)[PLAN_KEY_PREFIX + p] = r.byPlan[p] ?? 0
    }
    return out
  })

  return {
    id: 'chart-codex-plan-history',
    title: t('codexPlanHistory.title'),
    description: t('codexPlanHistory.description'),
    category: 'chart',
    sizes: [{ w: 2, h: 2 }, { w: 4, h: 2 }, { w: 2, h: 3 }, { w: 4, h: 3 }],
    minW: 2,
    minH: 2,
    screens: ['dashboard'],
    render: ({ h }) => (
      <div className="panel widget-panel">
        <PanelHeader
          title={t('codexPlanHistory.title')}
          sub={t('codexPlanHistory.sub')}
          help={t('codexPlanHistory.help')}
        />
        <div className="widget-panel-body widget-chart-body">
          {hasData ? (
            <div className="widget-chart-area">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                <ComposedChart data={chartRows} margin={TIMESERIES_MARGIN} barCategoryGap="20%">
                  <CartesianGrid stroke="var(--grid)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="_label" tickLine={false} axisLine={{ stroke: 'var(--grid)' }} interval="preserveStartEnd" hide={h <= 1} />
                  <YAxis tickLine={false} axisLine={{ stroke: 'var(--grid)' }} tickFormatter={fmtPct} width={TIMESERIES_YAXIS_WIDTH} />
                  <Tooltip content={<CodexPlanHistoryTooltip t={t} />} cursor={{ fill: 'var(--hover)' }} animationDuration={0} isAnimationActive={false} />
                  <Legend wrapperStyle={{ paddingTop: 8 }} iconType="square" />
                  {planList.map((plan, i) => (
                    <Bar
                      key={plan}
                      dataKey={PLAN_KEY_PREFIX + plan}
                      name={planLabel(plan, t)}
                      stackId="d"
                      fill={planColor(plan)}
                      radius={i === planList.length - 1 ? [3, 3, 0, 0] : 0}
                      isAnimationActive={false}
                    />
                  ))}
                  {/* 7-day cumulative window — overlaid as a smooth line
                      so the user can read "where the weekly meter is"
                      independently from each day's per-plan peaks. */}
                  {/* connectNulls=false: leave gaps where there was no
                      Codex usage — drawing a 7d-window line through
                      idle days would be a fabrication (the rolling
                      value carries over invisibly, we don't have it).
                      `dot` is enabled so isolated data points (range
                      with only 1–2 active days) still render as
                      visible markers instead of an invisible line. */}
                  <Line
                    type="monotone"
                    dataKey="_secondary"
                    name={t('codexPlanHistory.secondaryName')}
                    stroke="var(--text)"
                    strokeWidth={2}
                    strokeDasharray="4 3"
                    dot={{ fill: 'var(--text)', r: 3, stroke: 'none' }}
                    activeDot={{ r: 4 }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (<ChartEmpty />)}
        </div>
      </div>
    ),
  }
}
