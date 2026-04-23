import type { ReactNode } from 'react'
import { useEffect } from 'react'

export function ConfirmDialog({
  open, title, message, confirmLabel, cancelLabel,
  tone = 'default', onConfirm, onCancel,
}: {
  open: boolean
  title: string
  message: ReactNode
  confirmLabel: string
  cancelLabel: string
  tone?: 'default' | 'destructive'
  onConfirm: () => void
  onCancel: () => void
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
      if (e.key === 'Enter') onConfirm()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onConfirm, onCancel])
  if (!open) return null
  return (
    <>
      <div className="confirm-backdrop" onClick={onCancel} />
      <div className="confirm-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <h3 className="confirm-title">{title}</h3>
        <div className="confirm-message">{message}</div>
        <div className="confirm-actions">
          <button type="button" className="confirm-btn-cancel" onClick={onCancel}>{cancelLabel}</button>
          <button
            type="button"
            className={`confirm-btn-ok${tone === 'destructive' ? ' is-destructive' : ''}`}
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </>
  )
}
