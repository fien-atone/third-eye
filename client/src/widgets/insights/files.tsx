import { useRef } from 'react'
import type { WidgetDef } from '../grid'
import type { T } from '../../i18n'
import type { InsightsResponse } from '../../types'
import { PanelHeader, WidgetListMore } from '../../components/widgets-misc'
import { fmtCurrency, fmtInt } from '../../lib/format'
import { useFitCount } from '../../lib/use-fit-count'

function FilesBody({ t, files, stripProjectPrefix }: {
  t: T
  files: InsightsResponse['files']
  stripProjectPrefix: (p: string) => string
}) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const footerRef = useRef<HTMLDivElement>(null)
  const visibleCount = useFitCount(bodyRef, files.length, {
    rowSelector: 'tbody > tr',
    reserveBottom: 36,
    footerRef,
  })
  const fileBasename = (p: string) => p.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? p
  return (
    <div className="widget-panel-body widget-panel-body-fit" ref={bodyRef}>
      <table className="file-hotspots-table">
        <colgroup><col style={{ width: 'auto' }} /><col style={{ width: '90px' }} /><col style={{ width: '90px' }} /></colgroup>
        <thead><tr><th>{t('insights.files.colFile')}</th><th className="num">{t('insights.files.colTouches')}</th><th className="num">{t('insights.files.colCost')}</th></tr></thead>
        <tbody>
          {files.slice(0, visibleCount).map(f => {
            const stripped = stripProjectPrefix(f.name)
            const base = fileBasename(stripped)
            const dir = stripped.slice(0, -base.length)
            return (
              <tr key={f.name}>
                <td>
                  <div className="file-path-cell" tabIndex={0} title={f.name}>
                    <span className="file-dir">{dir}</span>
                    <span className="file-name">{base}</span>
                  </div>
                </td>
                <td className="num">{fmtInt(f.count)}</td>
                <td className="num">{fmtCurrency(f.cost)}</td>
              </tr>
            )
          })}
          {files.length === 0 && <tr><td colSpan={3} style={{ color: 'var(--text-dim)' }}>{t('insights.files.empty')}</td></tr>}
        </tbody>
      </table>
      <WidgetListMore ref={footerRef} shown={visibleCount} total={files.length} />
    </div>
  )
}

export function filesWidget(t: T, data: InsightsResponse, projectKey: string | null): WidgetDef {
  const stripProjectPrefix = (path: string) => {
    if (!projectKey) return path
    const real = projectKey.replace(/^-?Users-([^-]+)-/, '/Users/$1/').replace(/-/g, '/')
    return path.startsWith(real) ? path.slice(real.length).replace(/^\//, '') : path
  }
  return {
    id: 'files',
    title: t('insights.files.title'),
    description: t('widgets.files.description'),
    category: 'insights',
    section: 'insights',
    sizes: [{ w: 2, h: 3 }, { w: 4, h: 3 }, { w: 2, h: 2 }],
    minW: 2,
    minH: 2,
    render: () => (
      <div className="panel widget-panel">
        <PanelHeader
          title={t('insights.files.title')}
          sub={t('insights.files.subFmt', { unique: fmtInt(data.filesUnique), shown: data.files.length })}
          help={t('insights.files.help')}
        />
        <FilesBody t={t} files={data.files} stripProjectPrefix={stripProjectPrefix} />
      </div>
    ),
  }
}
