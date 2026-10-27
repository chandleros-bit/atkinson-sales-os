import { useBusiness } from '../context/BusinessContext'

const options = [
  { key: 'all', label: 'All' },
  { key: 'mpg', label: 'MPG', dot: 'var(--mpg)' },
  { key: 'bay', label: 'Bayway', dot: 'var(--bay)' },
]

// The All / MPG / Bayway switch. The selected one is navy; each book keeps its
// color as a dot, so the switch never reads as one book's control.
// compact: the phone top bar, where the dots don't fit.
export default function BusinessFilter({ compact = false }) {
  const { biz, setBiz } = useBusiness()

  return (
    <div role="tablist" aria-label="Business filter" className="flex rounded-[11px] border border-line2 bg-panel p-[3px]">
      {options.map((o) => {
        const active = biz === o.key
        return (
          <button
            key={o.key}
            role="tab"
            aria-selected={active}
            onClick={() => setBiz(o.key)}
            className={`flex min-h-[34px] flex-1 items-center justify-center gap-1.5 rounded-lg transition-colors ${
              compact ? 'px-1.5 text-[12.5px]' : 'px-3 text-[13.5px]'
            } ${active ? 'btn-primary font-semibold' : 'font-medium text-muted hover:text-[color:var(--text)]'}`}
          >
            {o.dot && !compact && <span aria-hidden="true" className="h-2 w-2 flex-none rounded-full" style={{ background: o.dot }} />}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
