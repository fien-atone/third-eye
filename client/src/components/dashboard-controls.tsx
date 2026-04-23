import { format, parseISO, subDays, startOfMonth, endOfMonth, startOfWeek, endOfWeek } from 'date-fns'
import type { Locale } from 'date-fns'
import { useT } from '../i18n'
import { useDateLocale, fmtCurrency, fmtInt } from '../lib/format'
import type { Granularity, OverviewResponse, ProvidersResponse } from '../types'
import { DateField } from './date-field'

type PresetKey = 'preset.7d' | 'preset.30d' | 'preset.12w' | 'preset.mtd' | 'preset.12m'
type Preset = {
  key: PresetKey
  get: (weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6) => { start: Date; end: Date; granularity: Granularity }
}
const PRESETS: Preset[] = [
  { key: 'preset.7d',  get: () => ({ start: subDays(new Date(), 6), end: new Date(), granularity: 'day' }) },
  { key: 'preset.30d', get: () => ({ start: subDays(new Date(), 29), end: new Date(), granularity: 'day' }) },
  { key: 'preset.12w', get: (w) => ({ start: startOfWeek(subDays(new Date(), 83), { weekStartsOn: w }), end: endOfWeek(new Date(), { weekStartsOn: w }), granularity: 'week' }) },
  { key: 'preset.mtd', get: () => ({ start: startOfMonth(new Date()), end: endOfMonth(new Date()), granularity: 'day' }) },
  { key: 'preset.12m', get: () => {
    const e = new Date()
    const s = new Date(e.getFullYear() - 1, e.getMonth(), 1)
    return { start: s, end: endOfMonth(e), granularity: 'month' }
  } },
]
export const DASHBOARD_DEFAULT_PRESET = PRESETS[1] // 30d

function formatFrameRange(startISO: string, endISO: string, g: Granularity, dl: Locale): string {
  const s = parseISO(startISO)
  const e = parseISO(endISO)
  if (g === 'month') return `${format(s, 'LLL yyyy', { locale: dl })} - ${format(e, 'LLL yyyy', { locale: dl })}`
  return `${format(s, 'PP', { locale: dl })} - ${format(e, 'PP', { locale: dl })}`
}

/** Shared toolbar for the home dashboard and the project view: view-
 *  granularity buttons, range presets + date pickers, provider chips,
 *  and the layout-customize toolbar (hidden under the mobile width
 *  breakpoint where GridStack drag/resize is disabled). The summary
 *  band below echoes the active range/granularity/providers as a
 *  human-readable confirmation of what the dashboard is showing. */
export function DashboardControls({
  granularity, setGranularity,
  start, setStart, end, setEnd,
  selectedProviders, setSelectedProviders, toggleProvider,
  providersData,
  frame,
  isNarrow,
  editingLayout, setEditingLayout,
  onResetLayout, onCancelEdit,
}: {
  granularity: Granularity
  setGranularity: (g: Granularity) => void
  start: Date
  setStart: (d: Date) => void
  end: Date
  setEnd: (d: Date) => void
  selectedProviders: string[]
  setSelectedProviders: (ps: string[]) => void
  toggleProvider: (id: string) => void
  providersData: ProvidersResponse | undefined
  frame: OverviewResponse['frame'] | null
  isNarrow: boolean
  editingLayout: boolean
  setEditingLayout: (v: boolean) => void
  onResetLayout: () => void
  onCancelEdit: () => void
}) {
  const t = useT()
  const dl = useDateLocale()
  const weekStartsOn = (dl.options?.weekStartsOn ?? 1) as 0 | 1 | 2 | 3 | 4 | 5 | 6
  return (
    <>
      <div className="controls">
        <div className="group">
          <span className="group-label">{t('controls.view')}</span>
          {(['day', 'week', 'month'] as Granularity[]).map(g => (
            <button key={g} className={granularity === g ? 'active' : ''} onClick={() => setGranularity(g)}>
              {g === 'day' ? t('controls.day') : g === 'week' ? t('controls.week') : t('controls.month')}
            </button>
          ))}
        </div>
        <div className="sep" />
        <div className="group">
          {PRESETS.map(p => (
            <button key={p.key} onClick={() => {
              const v = p.get(weekStartsOn)
              setStart(v.start)
              setEnd(v.end)
              setGranularity(v.granularity)
            }}>{t(p.key)}</button>
          ))}
          <span className="date-range-inline">
            <DateField value={start} onChange={setStart} />
            <span className="date-range-sep">→</span>
            <DateField value={end} onChange={setEnd} />
          </span>
        </div>
        <div className="sep" />
        <div className="group">
          <button
            className={selectedProviders.length === 0 ? 'chip active' : 'chip'}
            onClick={() => setSelectedProviders([])}
          >{t('controls.allProviders')}</button>
          {(providersData?.providers ?? []).map(p => (
            <button
              key={p.id}
              className={selectedProviders.includes(p.id) ? 'chip active' : 'chip'}
              onClick={() => toggleProvider(p.id)}
              title={`${fmtInt(p.calls)} calls · ${fmtCurrency(p.cost)}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="controls-spacer" />
        {isNarrow ? null : editingLayout ? (
          <div className="edit-toolbar-group">
            <button
              className="customize-reset-btn"
              onClick={onResetLayout}
              title={t('customize.reset')}
            >
              <span className="customize-icon" aria-hidden="true">↺</span>
              <span className="customize-label">{t('customize.reset')}</span>
            </button>
            <button
              className="customize-cancel-btn"
              onClick={onCancelEdit}
              title={t('customize.cancel')}
            >
              <span className="customize-icon" aria-hidden="true">✕</span>
              <span className="customize-label">{t('customize.cancel')}</span>
            </button>
            <button
              className="customize-btn on customize-save-btn"
              onClick={() => setEditingLayout(false)}
              title={t('controls.customize.done')}
              aria-label={t('controls.customize.done')}
              aria-pressed={true}
            >
              <span className="customize-icon" aria-hidden="true">✓</span>
              <span className="customize-label">{t('controls.customize.done')}</span>
            </button>
          </div>
        ) : (
          <button
            className="customize-btn"
            onClick={() => setEditingLayout(true)}
            title={t('controls.customize')}
            aria-label={t('controls.customize')}
            aria-pressed={false}
          >
            <span className="customize-icon" aria-hidden="true">⚙</span>
            <span className="customize-label">{t('controls.customize')}</span>
          </button>
        )}
      </div>

      {frame && (
        <div className="summary">
          <div>
            <strong>{formatFrameRange(frame.start, frame.end, granularity, dl)}</strong>
            <span className="dot">·</span>
            <span>{frame.bucketCount} {t(granularity === 'day' ? 'summary.days' : granularity === 'week' ? 'summary.weeks' : 'summary.months')}</span>
            <span className="dot">·</span>
            <span>{selectedProviders.length === 0 ? t('summary.allProviders') : selectedProviders.map(id => providersData?.providers.find(p => p.id === id)?.label ?? id).join(' + ')}</span>
          </div>
        </div>
      )}
    </>
  )
}
