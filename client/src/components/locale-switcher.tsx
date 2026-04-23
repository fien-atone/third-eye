import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useT, useLocale, LOCALES, LOCALE_KEYS } from '../i18n'

/** Header-pinned language picker. The menu is fixed-positioned (escapes
 *  any clipping ancestor), aligned to the trigger's right edge, and
 *  closes on outside click / scroll / resize. */
export function LocaleSwitcher() {
  const { locale, setLocale } = useLocale()
  const t = useT()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const tr = triggerRef.current.getBoundingClientRect()
    const vw = window.innerWidth
    const width = 160
    let left = tr.right - width
    if (left < 8) left = 8
    if (left + width > vw - 8) left = vw - 8 - width
    setPos({ left, top: tr.bottom + 6 })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const onScroll = () => setOpen(false)
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        className="ghost"
        onClick={() => setOpen(o => !o)}
        title={t('header.locale.title')}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span style={{ marginRight: 6 }}>{LOCALES[locale].flag}</span>{LOCALES[locale].native}
      </button>
      {open && pos && (
        <div
          ref={menuRef}
          className="locale-menu"
          role="menu"
          style={{ position: 'fixed', left: pos.left, top: pos.top, width: 180 }}
        >
          {LOCALE_KEYS.map(k => (
            <button
              key={k}
              role="menuitemradio"
              aria-checked={k === locale}
              className={`locale-item${k === locale ? ' active' : ''}`}
              onClick={() => { setLocale(k); setOpen(false) }}
            >
              <span className="locale-flag">{LOCALES[k].flag}</span>
              <span className="locale-text">
                <span className="locale-native">{LOCALES[k].native}</span>
                <span className="locale-name">{LOCALES[k].name}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  )
}
