import type { WidgetDef } from '../grid'
import type { T } from '../../i18n'
import type { InsightsResponse } from '../../types'
import { InsightsList } from '../panels'

export function bashWidget(t: T, data: InsightsResponse): WidgetDef {
  return {
    id: 'bash',
    title: t('insights.bash.title'),
    description: t('widgets.bash.description'),
    category: 'insights',
    sizes: [{ w: 2, h: 3 }, { w: 4, h: 3 }, { w: 2, h: 2 }],
    minW: 2,
    minH: 2,
    render: () => (
      <InsightsList title={t('insights.bash.title')} subtitle={t('insights.bash.sub')} rows={data.bash} unit={t('common.runs')} help={t('insights.bash.help')} />
    ),
  }
}
