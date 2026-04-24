import type { WidgetDef } from '../grid'
import type { T } from '../../i18n'
import type { InsightsResponse } from '../../types'
import { FlagStat, PanelHeader } from '../../components/widgets-misc'

export function flagsWidget(t: T, data: InsightsResponse): WidgetDef {
  return {
    id: 'flags',
    title: t('insights.flags.title'),
    description: t('widgets.flags.description'),
    category: 'insights',
    section: 'insights',
    sizes: [{ w: 2, h: 2 }, { w: 4, h: 2 }, { w: 2, h: 3 }],
    minW: 2,
    minH: 2,
    render: () => (
      <div className="panel widget-panel">
        <PanelHeader title={t('insights.flags.title')} help={t('insights.flags.help')} />
        <div className="widget-panel-body flag-grid-body">
          <div className="flag-grid">
            <FlagStat label={t('insights.flags.planMode')} value={data.flags.plan_mode_calls} total={data.flags.total_calls} />
            <FlagStat label={t('insights.flags.todoWrite')} value={data.flags.todo_write_calls} total={data.flags.total_calls} />
          </div>
        </div>
      </div>
    ),
  }
}
