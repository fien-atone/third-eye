import { useT } from '../i18n'
import type { Theme } from '../theme'

/** Tri-state theme cycler (light → dark → system → light). The single
 *  click cycles through all three so the entire control fits in one
 *  header button without a dropdown. */
export function ThemeToggle({ theme, setTheme }: { theme: Theme; setTheme: (t: Theme) => void }) {
  const t = useT()
  const next: Record<Theme, Theme> = { light: 'dark', dark: 'system', system: 'light' }
  const label: Record<Theme, string> = {
    light: t('header.theme.light'),
    dark: t('header.theme.dark'),
    system: t('header.theme.system'),
  }
  const icon: Record<Theme, string> = { light: '☀', dark: '☾', system: '◐' }
  return (
    <button className="ghost" onClick={() => setTheme(next[theme])} title={`${t('header.theme.title')}: ${label[theme]} (${t('header.theme.cycle')})`}>
      <span style={{ marginRight: 6 }}>{icon[theme]}</span>{label[theme]}
    </button>
  )
}
