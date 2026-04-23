import type { WidgetDef } from '../grid'
import type { T } from '../../i18n'
import type { OverviewResponse } from '../../types'
import { ModelsPanel } from '../panels'

export function modelsWidget(t: T, data: OverviewResponse): WidgetDef {
  return {
    id: 'models',
    title: t('panel.models.title'),
    description: t('widgets.models.description'),
    category: 'table',
    sizes: [{ w: 2, h: 3 }, { w: 4, h: 3 }, { w: 2, h: 4 }, { w: 4, h: 4 }],
    minW: 2,
    minH: 2,
    render: () => <ModelsPanel data={data} />,
  }
}
