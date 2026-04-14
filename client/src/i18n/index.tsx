import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { en, type Dict } from './en'
import { ru } from './ru'
import { zh } from './zh'
import { es } from './es'
import { de } from './de'

export const LOCALES = {
  en: { name: 'English',  native: 'English',  flag: '🇺🇸', dict: en },
  ru: { name: 'Russian',  native: 'Русский',  flag: '🇷🇺', dict: ru },
  zh: { name: 'Chinese',  native: '简体中文',   flag: '🇨🇳', dict: zh },
  es: { name: 'Spanish',  native: 'Español',  flag: '🇪🇸', dict: es },
  de: { name: 'German',   native: 'Deutsch',  flag: '🇩🇪', dict: de },
} as const

export type LocaleKey = keyof typeof LOCALES
export const LOCALE_KEYS = Object.keys(LOCALES) as LocaleKey[]

const STORAGE_KEY = 'third-eye-locale'

function detectBrowserLocale(): LocaleKey {
  const langs = [navigator.language, ...(navigator.languages ?? [])]
  for (const l of langs) {
    const code = l.toLowerCase().slice(0, 2)
    if (code in LOCALES) return code as LocaleKey
  }
  return 'en'
}

export function getStoredLocale(): LocaleKey {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v && v in LOCALES) return v as LocaleKey
  } catch {}
  return detectBrowserLocale()
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`))
}

export type T = (key: keyof Dict, vars?: Record<string, string | number>) => string

type Ctx = { t: T; locale: LocaleKey; setLocale: (l: LocaleKey) => void }
const LocaleContext = createContext<Ctx | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<LocaleKey>(() => getStoredLocale())

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, locale) } catch {}
    document.documentElement.lang = locale
  }, [locale])

  const value = useMemo<Ctx>(() => {
    const dict = LOCALES[locale].dict
    // Fallback chain: selected locale → en. Missing keys show the key itself (dev aid).
    const t: T = (key, vars) => interpolate(dict[key] ?? en[key] ?? String(key), vars)
    return { t, locale, setLocale: setLocaleState }
  }, [locale])

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export function useT(): T {
  const ctx = useContext(LocaleContext)
  if (!ctx) throw new Error('useT must be used within I18nProvider')
  return ctx.t
}

export function useLocale() {
  const ctx = useContext(LocaleContext)
  if (!ctx) throw new Error('useLocale must be used within I18nProvider')
  return ctx
}
