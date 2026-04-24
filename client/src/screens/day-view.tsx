/** Day view — single calendar day, hour-by-hour breakdown.
 *
 *  Owns the selected-day state (read from / written to the URL hash so
 *  ⌘+click and back/forward work natively). Runs an /api/overview
 *  query with start=end=selectedDay and granularity='hour', then hands
 *  the result to <Dashboard screenOverride='today'> so the widget grid
 *  pipeline is shared with the home / project screens.
 *
 *  Hour-timeline + day-scoped widgets are picked from the dashboard
 *  catalog automatically — registry.ts gates the hour-timeline on
 *  granularity==='hour'. */

import { useState, useMemo, useEffect } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { format } from 'date-fns'
import { Dashboard } from './dashboard'
import { useT } from '../i18n'
import { navigate } from '../router'
import { apiGet, dashboardParams } from '../api'
import { useDateLocale, toInputDate, parseLocalDate } from '../lib/format'
import type { OverviewResponse, ProjectsResponse } from '../types'
import { DateField } from '../components/date-field'
import { SlidersIcon } from '../components/icons'
import { hoursHeatstripWidget } from '../widgets/day/heatstrip-hour'
import { daysHoursHeatmapWidget } from '../widgets/day/heatmap-days-hours'
import { weekdayHourHeatmapWidget } from '../widgets/day/heatmap-weekday-hour'

function todayLocal(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function DayView({
  initialDate,
  selectedProviders,
  editing,
  setEditingLayout,
  isNarrow,
  onResetLayout,
  onCancelEdit,
  layoutEpoch,
  onLayoutReset,
  projectsData,
}: {
  /** Date in YYYY-MM-DD; if undefined we default to today. */
  initialDate?: string
  selectedProviders: string[]
  editing: boolean
  setEditingLayout: (v: boolean) => void
  isNarrow: boolean
  onResetLayout: () => void
  onCancelEdit: () => void
  layoutEpoch: number
  onLayoutReset: () => void
  projectsData: ProjectsResponse | undefined
}) {
  const t = useT()
  const dl = useDateLocale()
  const weekStartsOn = (dl.options?.weekStartsOn ?? 1) as 0 | 1 | 2 | 3 | 4 | 5 | 6

  const [selectedDate, setSelectedDate] = useState<string>(initialDate ?? todayLocal())
  // Keep URL hash in sync with selection so deep-links work both ways.
  useEffect(() => {
    if (selectedDate === todayLocal()) navigate({ name: 'today' })
    else navigate({ name: 'day', date: selectedDate })
  }, [selectedDate])
  // Push initial-date prop changes from the URL into local state when
  // the user uses back/forward across day URLs.
  useEffect(() => {
    if (initialDate && initialDate !== selectedDate) setSelectedDate(initialDate)
  }, [initialDate])

  const dateObj = useMemo(() => parseLocalDate(selectedDate), [selectedDate])

  const providersParam = selectedProviders.length === 0 ? 'all' : selectedProviders.join(',')
  const queryKey = ['overview', selectedDate, selectedDate, 'hour', providersParam, '', weekStartsOn]
  const overviewQuery = useQuery<OverviewResponse>({
    queryKey,
    queryFn: () => apiGet<OverviewResponse>(`/api/overview?${dashboardParams({
      start: dateObj, end: dateObj, providers: providersParam, granularity: 'hour', weekStartsOn,
    })}`),
    placeholderData: keepPreviousData,
  })

  const data = overviewQuery.data
  const modelNames = useMemo(() => (data?.models ?? []).map(m => m.name).slice(0, 8), [data])

  // Day-only widgets — three competing visualisations of activity
  // structure, exposed via Dashboard.extraWidgets so the user can
  // compare them side-by-side and remove the variants they don't like.
  const extraWidgets = useMemo(() => {
    if (!data) return []
    return [
      hoursHeatstripWidget(t, data.series),
      daysHoursHeatmapWidget(t, {
        id: 'days-hours-heatmap',
        daysCount: 30,
        titleKey: 'panel.daysHoursHeatmap.title',
        subKey: 'panel.daysHoursHeatmap.subFmt',
        descKey: 'widgets.days-hours-heatmap.description',
      }, selectedDate, providersParam, weekStartsOn, setSelectedDate),
      daysHoursHeatmapWidget(t, {
        id: 'days-hours-heatmap-week',
        daysCount: 7,
        titleKey: 'panel.daysHoursHeatmapWeek.title',
        subKey: 'panel.daysHoursHeatmapWeek.subFmt',
        descKey: 'widgets.days-hours-heatmap-week.description',
      }, selectedDate, providersParam, weekStartsOn, setSelectedDate),
      weekdayHourHeatmapWidget(t, selectedDate, providersParam, weekStartsOn),
    ]
  }, [t, data, selectedDate, providersParam, weekStartsOn])

  const isToday = selectedDate === todayLocal()

  const goPrev = () => {
    const d = new Date(dateObj)
    d.setDate(d.getDate() - 1)
    setSelectedDate(toInputDate(d))
  }
  const goNext = () => {
    const d = new Date(dateObj)
    d.setDate(d.getDate() + 1)
    setSelectedDate(toInputDate(d))
  }
  const goToday = () => setSelectedDate(todayLocal())

  return (
    <>
      <div className="day-header">
        <div className="day-header-title">
          <h1>{t('dayView.title')}</h1>
          <div className="day-header-date">{format(dateObj, 'EEEE, d MMMM yyyy', { locale: dl })}</div>
        </div>
        <div className="day-header-nav">
          <button className="ghost" onClick={goPrev} aria-label={t('dayView.prevDay')} title={t('dayView.prevDay')}>‹</button>
          <DateField value={dateObj} onChange={d => setSelectedDate(toInputDate(d))} />
          <button className="ghost" onClick={goNext} disabled={isToday} aria-label={t('dayView.nextDay')} title={t('dayView.nextDay')}>›</button>
          {!isToday && (
            <button className="ghost day-header-today-btn" onClick={goToday}>{t('dayView.today')}</button>
          )}
          {/* Edit-mode toolbar — same buttons as DashboardControls but
              co-located with the date picker since the day-view doesn't
              render the standard controls bar. Hidden under the mobile
              breakpoint where GridStack drag/resize is disabled. */}
          {!isNarrow && (editing ? (
            <div className="edit-toolbar-group">
              <button className="customize-reset-btn" onClick={onResetLayout} title={t('customize.reset')}>
                <span className="customize-icon" aria-hidden="true">↺</span>
                <span className="customize-label">{t('customize.reset')}</span>
              </button>
              <button className="customize-cancel-btn" onClick={onCancelEdit} title={t('customize.cancel')}>
                <span className="customize-icon" aria-hidden="true">✕</span>
                <span className="customize-label">{t('customize.cancel')}</span>
              </button>
              <button
                className="customize-btn on customize-save-btn"
                onClick={() => setEditingLayout(false)}
                title={t('controls.customize.done')}
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
              aria-pressed={false}
            >
              <span className="customize-icon" aria-hidden="true"><SlidersIcon size={14} /></span>
              <span className="customize-label">{t('controls.customize')}</span>
            </button>
          ))}
        </div>
      </div>

      {overviewQuery.isLoading && !data && <div className="loading">{t('common.loading')}</div>}
      {overviewQuery.error && <div className="error">{t('common.error')}: {(overviewQuery.error as Error).message}</div>}
      {data && (
        <Dashboard
          data={data}
          modelNames={modelNames}
          granularity="hour"
          onSelectProject={(key) => {
            const p = projectsData?.projects.find(x => x.key === key)
            if (p) navigate({ name: 'project', id: p.id })
          }}
          inProjectView={false}
          editing={editing}
          layoutEpoch={layoutEpoch}
          onLayoutReset={onLayoutReset}
          screenOverride="today"
          extraWidgets={extraWidgets}
        />
      )}
    </>
  )
}
