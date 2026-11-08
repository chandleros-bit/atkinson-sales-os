import { useBusiness } from '../context/BusinessContext'

const options = [
  { key: 'all', label: 'All' },
  { key: 'mpg', label: 'MPG', dot: 'var(--mpg)' },
  { key: 'bay', label: 'Bayway', dot: 'var(--bay)' },
]

// The All / MPG / Bayway switch: the app's only business control. The
// selected one is navy; each book keeps its color as a dot, so the switch
// never reads as one book's control.
// books: a page that shows one book at a time (Pipeline, Contacts) - the
//   switch offers MPG | Bayway and picks the page's book.
// compact: the phone top bar, where the dots don't fit.
export default function BusinessFilter({ compact = false, books = false }) {
  const { biz, setBiz, book, setBook } = useBusiness()
  const shown = books ? options.filter((o) => o.key !== 'all') : options
  const current = books ? book : biz
  const pick = books ? setBook : setBiz

  return (
    <div
      role="tablist"
      aria-label={books ? 'Book' : 'Business filter'}
      className="flex rounded-lg border border-line2 bg-panel p-[3px]"
    >
      {shown.map((o) => {
        const active = current === o.key
        return (
          <button
            key={o.key}
            role="tab"
            aria-selected={active}
            onClick={() => pick(o.key)}
            className={`flex min-h-[34px] flex-1 items-center justify-center gap-1.5 rounded-lg transition-colors ${
              compact ? 'px-1.5 text-body' : 'px-3 text-ui'
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
