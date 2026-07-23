import { useBusiness } from '../context/BusinessContext'

const options = [
  { key: 'all', label: 'All' },
  { key: 'mpg', label: 'MPG' },
  { key: 'bay', label: 'Bayway' },
]

export default function BusinessFilter() {
  const { biz, setBiz } = useBusiness()

  return (
    <div
      role="tablist"
      aria-label="Business filter"
      className="flex rounded-[10px] border border-line bg-panel p-[3px]"
    >
      {options.map((o) => {
        const active = biz === o.key
        return (
          <button
            key={o.key}
            role="tab"
            aria-selected={active}
            onClick={() => setBiz(o.key)}
            className={`flex-1 rounded-[7px] py-1.5 text-xs font-semibold transition-colors ${
              active ? 'text-[color:var(--text)]' : 'text-muted hover:text-[color:var(--text)]'
            } ${active && o.key === 'all' ? 'grad-dual-soft' : ''}`}
            style={
              active && o.key === 'mpg'
                ? { background: 'var(--mpg-soft)', color: 'var(--mpg-ink)' }
                : active && o.key === 'bay'
                  ? { background: 'var(--bay-soft)', color: 'var(--bay-ink)' }
                  : undefined
            }
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
