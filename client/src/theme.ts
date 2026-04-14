export type Theme = 'light' | 'dark' | 'system'

const KEY = 'codeburn-theme'

export function getStoredTheme(): Theme {
  const v = localStorage.getItem(KEY)
  if (v === 'light' || v === 'dark' || v === 'system') return v
  return 'system'
}

export function applyTheme(theme: Theme) {
  const resolved = theme === 'system'
    ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme
  document.documentElement.setAttribute('data-theme', resolved)
  localStorage.setItem(KEY, theme)
}

export function initTheme() {
  applyTheme(getStoredTheme())
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getStoredTheme() === 'system') applyTheme('system')
  })
}
