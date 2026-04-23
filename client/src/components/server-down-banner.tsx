import { useT } from '../i18n'

/** Persistent banner shown at the top of the page when the API is
 *  unreachable. Provides retry + the most common ways to bring the
 *  backend back up so users aren't left guessing what to do. */
export function ServerDownBanner({ onRetry }: { onRetry: () => void }) {
  const t = useT()
  return (
    <div className="server-down">
      <div className="server-down-head">
        <span className="server-down-icon" aria-hidden="true">⚠</span>
        <div className="server-down-body">
          <div className="server-down-title">{t('server.down.title')}</div>
          <div className="server-down-msg">{t('server.down.msg')}</div>
        </div>
        <button className="primary" onClick={onRetry}>{t('server.down.retry')}</button>
      </div>
      <div className="server-down-cmds">
        <div className="cmd-row"><span className="cmd-label">{t('server.down.docker')}</span><code>docker compose up -d</code></div>
        <div className="cmd-row"><span className="cmd-label">{t('server.down.node')}</span><code>npm start</code></div>
        <div className="cmd-row"><span className="cmd-label">{t('server.down.check')}</span><code><a href="http://localhost:4317/api/health" target="_blank" rel="noreferrer">http://localhost:4317/api/health</a></code></div>
      </div>
    </div>
  )
}
