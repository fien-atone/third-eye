import type { WidgetDef } from '../grid'
import type { T } from '../../i18n'
import type { InsightsResponse } from '../../types'
import { InsightsList } from '../panels'

export function mcpWidget(t: T, data: InsightsResponse): WidgetDef {
  return {
    id: 'mcp',
    title: t('insights.mcp.title'),
    description: t('widgets.mcp.description'),
    category: 'insights',
    section: 'insights',
    sizes: [{ w: 2, h: 3 }, { w: 4, h: 3 }, { w: 2, h: 2 }],
    minW: 2,
    minH: 2,
    render: () => (
      <InsightsList title={t('insights.mcp.title')} subtitle={t('insights.mcp.sub')} rows={data.mcp} unit={t('common.calls')} help={t('insights.mcp.help')} />
    ),
  }
}
