// The sidebar's "+ New" menu (Tier 1 quick add). Log call / Note / Follow-up
// ask who first (the search palette in pick mode); Task opens the New Task
// dialog. The caller decides what each kind does.
// Spec: docs/superpowers/specs/2026-10-19-tier1-pipeline-flow-design.md (5)
import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'

export const QUICK_ADD = [
  { kind: 'call', label: 'Log call…' },
  { kind: 'note', label: 'Note…' },
  { kind: 'followup', label: 'Follow-up…' },
  { kind: 'task', label: 'Task…' },
]

const NEW_LEAD = { kind: 'lead', label: 'New lead…' }
const LOG_VISIT = { kind: 'visit', label: 'Log visit…' }

// showLead: offer "New lead…" (settings.create_lead_enabled plus write-back).
// showVisit: offer "Log visit…" (MPG walk-ins; hidden on the Bayway view).
// hide: kinds this login can't use (the assistant has no Log call).
export default function QuickAddMenu({ onPick, showLead = false, showVisit = false, hide = [], className = 'btn-primary', style }) {
  const [open, setOpen] = useState(false)
  const items = [...(showLead ? [NEW_LEAD] : []), ...(showVisit ? [LOG_VISIT] : []), ...QUICK_ADD].filter((i) => !hide.includes(i.kind))
  const box = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    const onDown = (e) => box.current && !box.current.contains(e.target) && setOpen(false)
    window.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open])

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-10 w-full items-center justify-center gap-1.5 rounded-[10px] px-4 text-[14px] font-semibold ${className}`}
        style={style}
      >
        <Icon name="plus" size={16} strokeWidth={2.2} />
        New
      </button>
      {open && (
        <div
          role="menu"
          aria-label="New"
          className="absolute right-0 top-[46px] z-30 w-[200px] rounded-xl border border-line bg-panel p-1 shadow-lg"
        >
          {items.map((it) => (
            <button
              key={it.kind}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                onPick(it.kind)
              }}
              className="flex min-h-[40px] w-full items-center rounded-lg px-2.5 text-left text-[13px] font-semibold hover:bg-hoverbg"
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
