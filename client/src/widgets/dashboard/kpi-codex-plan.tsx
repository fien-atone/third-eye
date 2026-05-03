/**
 * KPI: Codex / ChatGPT plan usage.
 *
 * Snapshot of the OpenAI plan rate-limit state pulled from the
 * latest token_count event in any Codex session. Anthropic's API
 * has no equivalent, so this is provider-specific.
 *
 * Visibility rules:
 *   - Hidden entirely when the scope has no Codex calls (server
 *     returns codexPlan: null in that case).
 *   - Shown with a "stale" hint when the snapshot is more than
 *     24h old — credits could've reset multiple times since,
 *     so the percentage is no longer trustworthy.
 *   - Shown with a "limit reached" red accent when the parsed
 *     payload's rate_limit_reached_type field is set.
 *
 * Display:
 *   - 1×1 compact: "Free · 3% · 5d" (plan / used % / time-to-reset)
 *   - 2×1 expanded: plan name + progress bar + reset countdown
 */

import type { WidgetDef } from '../grid'
import type { T } from '../../i18n'
import type { OverviewResponse } from '../../types'
import { KpiGroup, KpiMetric } from '../../components/widgets-misc'

const STALE_HOURS = 24
const HOUR = 60 * 60 * 1000

function fmtTimeToReset(resetsAt: number, t: T): string {
  if (!resetsAt) return '—'
  const ms = resetsAt * 1000 - Date.now()
  if (ms <= 0) return t('codexPlan.resetting')
  const totalMin = Math.round(ms / 60_000)
  const days = Math.floor(totalMin / (60 * 24))
  const hours = Math.floor((totalMin % (60 * 24)) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h`
  return t('codexPlan.minutesFmt', { n: totalMin })
}

function fmtPlanType(planType: string | null, t: T): string {
  if (!planType) return t('codexPlan.unknown')
  if (planType === 'free') return t('codexPlan.planFree')
  // Plus / Pro / Enterprise / Edu — pass through as-is, they're
  // proper nouns Anthropic^WOpenAI uses verbatim.
  return planType.charAt(0).toUpperCase() + planType.slice(1)
}

function isStale(capturedAt: string): boolean {
  const ageMs = Date.now() - new Date(capturedAt).getTime()
  return ageMs > STALE_HOURS * HOUR
}

export function kpiCodexPlanWidget(t: T, data: OverviewResponse): WidgetDef {
  const plan = data.codexPlan
  const stale = plan ? isStale(plan.capturedAt) : false
  const limited = !!plan?.rateLimitReachedType
  const planLabel = fmtPlanType(plan?.planType ?? null, t)
  const usedPct = plan?.primary?.usedPercent ?? 0
  const resetTxt = plan?.primary?.resetsAt ? fmtTimeToReset(plan.primary.resetsAt, t) : '—'
  // Tooltip explains stale-ness when relevant (per-cell, not on the
  // whole tile, so users don't get a tooltip for the static label
  // they already understand).
  const staleTooltip = stale
    ? t('codexPlan.staleTooltip', {
        when: new Date(plan!.capturedAt).toLocaleString(),
      })
    : undefined

  return {
    id: 'kpi-codex-plan',
    title: t('codexPlan.title'),
    description: t('codexPlan.description'),
    category: 'kpi',
    sizes: [{ w: 1, h: 1 }, { w: 2, h: 1 }],
    minW: 1,
    minH: 1,
    render: () => {
      // Empty state — the widget exists in the picker but the
      // current scope is Codex-free or no snapshot has been ingested
      // yet. Guidance helps users who added this without realizing
      // it requires Codex usage.
      if (!plan) {
        return (
          <KpiGroup title={t('codexPlan.title')}>
            <KpiMetric label={t('codexPlan.stateLabel')} value="—" sub={t('codexPlan.empty')} />
          </KpiGroup>
        )
      }
      return (
        <KpiGroup title={t('codexPlan.title')}>
          <KpiMetric
            label={t('codexPlan.planLabel')}
            value={planLabel}
            sub={limited ? t('codexPlan.limitReached') : undefined}
            title={staleTooltip}
          />
          <KpiMetric
            label={t('codexPlan.usedLabel')}
            value={`${usedPct.toFixed(usedPct < 10 ? 1 : 0)}%`}
            sub={t('codexPlan.resetsInFmt', { time: resetTxt })}
            title={staleTooltip}
          />
        </KpiGroup>
      )
    },
  }
}
