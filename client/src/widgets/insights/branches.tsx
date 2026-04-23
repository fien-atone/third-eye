import { useRef } from 'react'
import type { WidgetDef } from '../grid'
import type { T } from '../../i18n'
import type { InsightsResponse } from '../../types'
import { ChartEmpty, MidEllipsis, PanelHeader, WidgetListMore } from '../../components/widgets-misc'
import { fmtCurrency, fmtInt } from '../../lib/format'
import { useFitCount } from '../../lib/use-fit-count'

function BranchesBody({ t, branches }: { t: T; branches: InsightsResponse['branches'] }) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const footerRef = useRef<HTMLDivElement>(null)
  const visibleCount = useFitCount(bodyRef, branches.length, {
    rowSelector: 'tbody > tr',
    reserveBottom: 36,
    footerRef,
  })
  return (
    <div className="widget-panel-body widget-panel-body-fit" ref={bodyRef}>
      {branches.length === 0 ? (
        <ChartEmpty hint={t('insights.branches.empty')} />
      ) : (
        <>
          <table className="breakdown breakdown-branches">
            <colgroup>
              <col />
              <col style={{ width: 64 }} />
              <col style={{ width: 80 }} />
            </colgroup>
            <thead><tr><th>{t('insights.branches.colBranch')}</th><th className="num">{t('insights.branches.colCalls')}</th><th className="num">{t('insights.branches.colCost')}</th></tr></thead>
            <tbody>
              {branches.slice(0, visibleCount).map(b => (
                <tr key={b.name}>
                  <td className="branch-cell"><span className="branch-name-mono" title={b.name}><MidEllipsis text={b.name} /></span></td>
                  <td className="num">{fmtInt(b.calls)}</td>
                  <td className="num">{fmtCurrency(b.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <WidgetListMore ref={footerRef} shown={visibleCount} total={branches.length} />
        </>
      )}
    </div>
  )
}

export function branchesWidget(t: T, data: InsightsResponse): WidgetDef {
  return {
    id: 'branches',
    title: t('insights.branches.title'),
    description: t('widgets.branches.description'),
    category: 'insights',
    sizes: [{ w: 2, h: 3 }, { w: 4, h: 3 }, { w: 2, h: 2 }],
    minW: 2,
    minH: 2,
    render: () => (
      <div className="panel widget-panel">
        <PanelHeader title={t('insights.branches.title')} sub={t('insights.branches.sub')} help={t('insights.branches.help')} />
        <BranchesBody t={t} branches={data.branches} />
      </div>
    ),
  }
}
