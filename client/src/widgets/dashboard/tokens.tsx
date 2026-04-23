import type { WidgetDef } from '../grid'
import type { T } from '../../i18n'
import type { Granularity } from '../../types'
import { TokensPanel } from '../panels'

export function tokensWidget(
  t: T,
  series: Array<Record<string, number | string>>,
  granularity: Granularity,
  hasTokenData: boolean,
): WidgetDef {
  return {
    id: 'tokens',
    title: t('panel.tokens.title'),
    description: t('widgets.tokens.description'),
    category: 'chart',
    sizes: [{ w: 4, h: 2 }, { w: 2, h: 2 }, { w: 2, h: 3 }, { w: 4, h: 3 }],
    minW: 2,
    minH: 2,
    render: ({ h }) => (
      <TokensPanel series={series} granularity={granularity} hasData={hasTokenData} showLegend={h >= 3} />
    ),
  }
}
