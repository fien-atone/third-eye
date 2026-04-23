import { useRef } from 'react'
import type { WidgetDef } from '../grid'
import type { T } from '../../i18n'
import type { OverviewResponse } from '../../types'
import { ChartEmpty, HelpTip, MidEllipsis, WidgetListMore } from '../../components/widgets-misc'
import { fmtCurrency, fmtInt } from '../../lib/format'
import { hrefFor } from '../../router'
import { useFitCount } from '../../lib/use-fit-count'

function TopProjectsBody({ t, projects }: { t: T; projects: OverviewResponse['projects'] }) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const footerRef = useRef<HTMLDivElement>(null)
  const visibleCount = useFitCount(bodyRef, projects.length, {
    rowSelector: 'tbody > tr',
    reserveBottom: 36,
    footerRef,
  })
  return (
    <div className="widget-panel-body widget-panel-body-fit" ref={bodyRef}>
      {projects.length === 0 ? <ChartEmpty /> : (
        <>
          <table className="breakdown breakdown-projects">
            <colgroup>
              <col />
              <col style={{ width: 80 }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 32 }} />
            </colgroup>
            <thead><tr><th>{t('panel.topProjects.colProject')}</th><th className="num">{t('panel.topProjects.colCalls')}</th><th className="num">{t('panel.topProjects.colCost')}</th><th /></tr></thead>
            <tbody>
              {projects.slice(0, visibleCount).map(p => (
                <tr key={p.name} className="clickable">
                  <td className="project-cell">
                    {p.id && (
                      <a className="row-stretch-link" href={hrefFor({ name: 'project', id: p.id })} aria-label={p.label} />
                    )}
                    <span className="project-name">
                      {p.favorite && <span className="fav-star" aria-hidden="true">★</span>}
                      <span className="project-name-wrap"><MidEllipsis text={p.label} /></span>
                    </span>
                  </td>
                  <td className="num">{fmtInt(p.calls)}</td>
                  <td className="num">{fmtCurrency(p.cost)}</td>
                  <td className="open-arrow-cell"><span className="open-arrow">→</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          <WidgetListMore ref={footerRef} shown={visibleCount} total={projects.length} />
        </>
      )}
    </div>
  )
}

export function topProjectsWidget(t: T, data: OverviewResponse): WidgetDef {
  return {
    id: 'top-projects',
    title: t('panel.topProjects.title'),
    description: t('widgets.top-projects.description'),
    category: 'table',
    sizes: [{ w: 2, h: 3 }, { w: 4, h: 3 }, { w: 2, h: 2 }],
    minW: 2,
    minH: 2,
    render: () => (
      <div className="panel widget-panel">
        <div className="panel-head">
          <div className="panel-title-row">
            <h3 style={{ margin: 0 }}>{t('panel.topProjects.title')}</h3>
            <HelpTip>{t('panel.topProjects.help')}</HelpTip>
          </div>
        </div>
        <TopProjectsBody t={t} projects={data.projects} />
      </div>
    ),
  }
}
