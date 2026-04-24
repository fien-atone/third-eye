import { useT } from '../i18n'

/** App footer — copyright, contact, version (linked to GitHub releases
 *  so users can compare against the latest), and license badge. */
export function Footer() {
  const t = useT()
  const year = new Date().getFullYear()
  const version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : null
  return (
    <footer className="footer">
      <div>
        © {year} Ivan Shumov
        <span className="dot">·</span>
        <a href="mailto:contact@ivanshumov.com">contact@ivanshumov.com</a>
      </div>
      <div>
        {version && (
          <>
            <a
              className="footer-version"
              href="https://github.com/fien-atone/third-eye/releases"
              target="_blank"
              rel="noopener noreferrer"
              title={t('footer.releasesTitle')}
            >v{version}</a>
            <span className="dot">·</span>
          </>
        )}
        <span className="badge">MIT</span>
      </div>
    </footer>
  )
}
