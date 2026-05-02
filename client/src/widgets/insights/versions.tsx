import type { WidgetDef } from '../grid'
import type { T } from '../../i18n'
import type { InsightsResponse } from '../../types'
import { VersionsPanel } from '../panels'

export function versionsWidget(t: T, data: InsightsResponse): WidgetDef {
  return {
    id: 'versions',
    title: t('insights.versions.title'),
    description: t('widgets.versions.description'),
    category: 'insights',
    section: 'insights',
    sizes: [{ w: 4, h: 2 }, { w: 2, h: 2 }, { w: 4, h: 3 }],
    minW: 2,
    minH: 2,
    render: () => <VersionsPanel rows={data.versions} />,
  }
}
