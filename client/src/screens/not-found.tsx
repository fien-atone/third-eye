import { Logo } from '../Logo'
import { useT } from '../i18n'
import { navigate } from '../router'

export function NotFound() {
  const t = useT()
  return (
    <div className="notfound">
      <div className="notfound-logo"><Logo size={72} /></div>
      <div className="notfound-code">{t('notfound.code')}</div>
      <div className="notfound-title">{t('notfound.title')}</div>
      <div className="notfound-msg">{t('notfound.message')}</div>
      <button className="primary" onClick={() => navigate({ name: 'home' })}>
        {t('notfound.home')}
      </button>
    </div>
  )
}
