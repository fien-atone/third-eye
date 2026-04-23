/** Number / currency / token formatters and chart palette. */

import { format, parseISO } from 'date-fns'
import type { Locale } from 'date-fns'
import { useLocale } from '../i18n'
import { DATE_LOCALES } from '../i18n/dateLocale'
import type { T } from '../i18n'

/** Stable color palette used across all charts (matches CSS variables). */
export const COLORS = [
  'var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)',
  'var(--chart-6)', 'var(--chart-7)', 'var(--chart-8)', 'var(--chart-9)', 'var(--chart-10)',
]

export function fmtCurrency(v: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: v < 10 ? 2 : 0 }).format(v)
}

export function fmtInt(v: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(v))
}

export function fmtTokens(v: number): string {
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B'
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M'
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'k'
  return String(Math.round(v))
}

/** Hook: access the currently-selected date-fns Locale object. */
export function useDateLocale(): Locale {
  const { locale } = useLocale()
  return DATE_LOCALES[locale]
}

/** Compact locale-aware date for table cells. */
export function useFmtDateCompact() {
  const dl = useDateLocale()
  return (iso: string) => format(parseISO(iso), 'd MMM yyyy', { locale: dl })
}

/** Format a relative time ("2 min ago") for the last-refresh indicator. */
export function fmtRel(iso: string | null, t: T): string {
  if (!iso) return t('time.never')
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.floor(ms / 60_000)
  if (m < 1) return t('time.justNow')
  if (m < 60) return t('time.minAgo', { n: m })
  const h = Math.floor(m / 60)
  if (h < 24) return t('time.hourAgo', { n: h })
  return t('time.dayAgo', { n: Math.floor(h / 24) })
}

/** Parse a YYYY-MM-DD string as a local-calendar Date (NOT UTC midnight). */
export function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

/** Date → "yyyy-MM-dd" (local-calendar) for date input fields and API params. */
export function toInputDate(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}
