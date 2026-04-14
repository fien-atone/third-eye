import type { Locale } from 'date-fns'
import { enUS } from 'date-fns/locale/en-US'
import { ru } from 'date-fns/locale/ru'
import { zhCN } from 'date-fns/locale/zh-CN'
import { es } from 'date-fns/locale/es'
import { de } from 'date-fns/locale/de'
import type { LocaleKey } from './index'

export const DATE_LOCALES: Record<LocaleKey, Locale> = {
  en: enUS,
  ru,
  zh: zhCN,
  es,
  de,
}
