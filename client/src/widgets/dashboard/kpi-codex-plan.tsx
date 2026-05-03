/**
 * KPI: Codex / ChatGPT plan usage for a single day.
 *
 * Composite snapshot of OpenAI rate-limit state for the displayed day.
 * Codex emits two independent limit families per session:
 *   - `limit_id="codex"`    — rolling 5h primary + 7d secondary windows
 *   - `limit_id="premium"`  — Plus/Pro credit pool (no windows)
 * Server-side aggregation merges both into one `data.codexPlan` row;
 * see server/lib/providers/codex.ts > aggregateCodexPlanDaily.
 *
 * Display rules:
 *   - Plan tile  — always present (plan_type from latest sample).
 *                  Sub-line shows "Limit reached" red accent when:
 *                    a) credits.hasCredits === false (Plus credits
 *                       exhausted — what CLI shows even if window % low),
 *                    b) rateLimitReachedType is set (rare; CLI rarely
 *                       populates this in the JSONL, but we honor it).
 *   - Used (5h)  — peak primary.used_percent observed during the day.
 *                  Hidden if no `codex`-family samples on the day
 *                  (e.g. a day spent entirely on premium credits).
 *   - Credits   — present when `limit_id="premium"` was seen on the
 *                  day. The big VALUE column stays short ("0", "∞",
 *                  the balance number) so the tile renders cleanly
 *                  even at 1×1; descriptive words ("exhausted",
 *                  "unlimited") go in the smaller sub-line.
 *
 * Sizes: 1×1 / 2×1 / 3×1 — wide enough to fit Plan + Used + Credits
 * side-by-side at 3×1, two metrics at 2×1, single column at 1×1.
 *
 * Visibility (catalog-level): `screens: ['today']` only — multi-day
 * ranges have no single meaningful peak.
 */

import type { WidgetDef } from '../grid'
import type { T } from '../../i18n'
import type { OverviewResponse } from '../../types'
import { KpiGroup, KpiMetric } from '../../components/widgets-misc'

/** Format the time-to-reset for a window, or null when the reset is
 *  already in the past. Past-reset means the rolling window has cycled
 *  since the snapshot was captured: trivially true for any historical
 *  day-view (we're looking at yesterday's peak, today's reset already
 *  happened), and possible mid-day too if the user is viewing a 5h-
 *  window snapshot that's now older than 5h. In both cases the
 *  countdown would be misleading — return null and the caller skips
 *  the sub-line. */
function fmtTimeToReset(resetsAt: number, t: T): string | null {
  if (!resetsAt) return null
  const ms = resetsAt * 1000 - Date.now()
  if (ms <= 0) return null
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
  // Plus / Pro / Enterprise / Edu / Go — pass through capitalized,
  // they're proper nouns OpenAI uses verbatim.
  return planType.charAt(0).toUpperCase() + planType.slice(1)
}

type Credits = NonNullable<NonNullable<OverviewResponse['codexPlan']>['credits']>

/** Format credits for the Credits KpiMetric. Strategy: keep `value`
 *  short and numeric/symbolic so the big-text column doesn't overflow
 *  on a 1×1 tile, and put the human word ("exhausted", "unlimited")
 *  in `sub` where it has more room. `unlimited` wins over balance
 *  because Codex sometimes ships both a true `unlimited` and a stale
 *  balance number. */
function fmtCredits(c: Credits, t: T): { value: string; sub?: string } {
  if (c.unlimited === true) {
    return { value: '∞', sub: t('codexPlan.creditsUnlimited') }
  }
  if (c.hasCredits === false) {
    // Distinct from "0 balance with hasCredits=true" — explicit
    // exhaustion is the binding signal CLI uses for "limit reached".
    return { value: '0', sub: t('codexPlan.creditsExhausted') }
  }
  if (c.balance !== null) return { value: c.balance }
  return { value: '—' }
}

export function kpiCodexPlanWidget(t: T, data: OverviewResponse): WidgetDef {
  const plan = data.codexPlan
  // The user-facing "you're out" signal. rate_limit_reached_type is
  // documented but rarely populated by Codex; credits.hasCredits=false
  // is the actual indicator on paid plans.
  const creditsExhausted = plan?.credits?.hasCredits === false
  const limited = !!plan?.rateLimitReachedType || creditsExhausted
  const planLabel = fmtPlanType(plan?.planType ?? null, t)
  const usedPct = plan?.primary?.usedPercent ?? 0
  const resetTxt = plan?.primary?.resetsAt ? fmtTimeToReset(plan.primary.resetsAt, t) : null
  // Show the 5h-window metric only when the day actually had codex-
  // family samples — `primary` is null when the day was entirely on
  // premium credits, and showing "0%" there would be misleading.
  const showWindow = !!plan?.primary
  const showCredits = !!plan?.credits
  const credits = plan?.credits ?? null
  const creditsView = credits ? fmtCredits(credits, t) : null

  return {
    id: 'kpi-codex-plan',
    title: t('codexPlan.title'),
    description: t('codexPlan.description'),
    category: 'kpi',
    sizes: [{ w: 1, h: 1 }, { w: 2, h: 1 }, { w: 3, h: 1 }],
    minW: 1,
    minH: 1,
    // Daily snapshot only matches the Today URL where the displayed
    // day equals the aggregated day. Reconcile() scrubs the id from
    // any saved layout on Dashboard / Project that referenced it.
    screens: ['today'],
    render: () => {
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
          />
          {showWindow && (
            <KpiMetric
              label={t('codexPlan.usedLabel')}
              value={`${usedPct.toFixed(usedPct < 10 ? 1 : 0)}%`}
              sub={resetTxt ? t('codexPlan.resetsInFmt', { time: resetTxt }) : undefined}
              />
          )}
          {showCredits && creditsView && (
            <KpiMetric
              label={t('codexPlan.creditsLabel')}
              value={creditsView.value}
              sub={creditsView.sub}
              />
          )}
        </KpiGroup>
      )
    },
  }
}
