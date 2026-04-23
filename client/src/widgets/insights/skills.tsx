import type { WidgetDef } from '../grid'
import type { T } from '../../i18n'
import type { InsightsResponse } from '../../types'
import { InsightsList } from '../panels'

export function skillsWidget(t: T, data: InsightsResponse): WidgetDef {
  return {
    id: 'skills',
    title: t('insights.skills.title'),
    description: t('widgets.skills.description'),
    category: 'insights',
    sizes: [{ w: 2, h: 3 }, { w: 4, h: 3 }, { w: 2, h: 2 }],
    minW: 2,
    minH: 2,
    render: () => (
      <InsightsList title={t('insights.skills.title')} subtitle={t('insights.skills.sub')} rows={data.skills} unit={t('common.calls')} help={t('insights.skills.help')} />
    ),
  }
}
