// One app-wide toast, mounted once in Layout. Lives outside the rows that fire
// it, so a toast survives the row disappearing (a completed task) or the page
// reloading its data after a write.
import { useEffect, useState } from 'react'

const listeners = new Set()

// toast: { tone: 'ok' | 'partial' | 'error', text, retry?: () => void }
export function showToast(toast) {
  listeners.forEach((fn) => fn(toast))
}

export default function Toaster() {
  const [toast, setToast] = useState(null)

  useEffect(() => {
    listeners.add(setToast)
    return () => listeners.delete(setToast)
  }, [])

  useEffect(() => {
    if (!toast || toast.tone !== 'ok') return undefined
    const id = setTimeout(() => setToast(null), 3200)
    return () => clearTimeout(id)
  }, [toast])

  if (!toast) return null
  const bad = toast.tone !== 'ok'
  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-[60] flex max-w-[92vw] -translate-x-1/2 items-center gap-3 rounded-[12px] px-4 py-3 text-[13px] font-semibold shadow-lg"
      style={{ background: bad ? 'var(--neg-ink)' : 'var(--text)', color: '#fff' }}
    >
      <span>{toast.text}</span>
      {bad && toast.retry && (
        <button
          type="button"
          onClick={() => {
            setToast(null)
            toast.retry()
          }}
          className="min-h-[32px] rounded-md border border-white/60 px-2"
        >
          Retry
        </button>
      )}
      {bad && (
        <button type="button" onClick={() => setToast(null)} aria-label="Dismiss" className="min-h-[32px] px-1">
          ✕
        </button>
      )}
    </div>
  )
}
