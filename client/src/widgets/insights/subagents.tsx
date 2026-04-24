import type { WidgetDef } from '../grid'
import type { T } from '../../i18n'
import type { InsightsResponse } from '../../types'
import { InsightsList } from '../panels'

export function subagentsWidget(t: T, data: InsightsResponse): WidgetDef {
  return {
    id: 'subagents',
    title: t('insights.subagents.title'),
    description: t('widgets.subagents.description'),
    category: 'insights',
    section: 'insights',
    sizes: [{ w: 2, h: 3 }, { w: 4, h: 3 }, { w: 2, h: 2 }],
    minW: 2,
    minH: 2,
    render: () => (
      <InsightsList title={t('insights.subagents.title')} subtitle={t('insights.subagents.sub')} rows={data.subagents} unit={t('common.calls')} help={t('insights.subagents.help')} />
    ),
  }
}
