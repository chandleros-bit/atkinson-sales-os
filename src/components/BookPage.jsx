// Pipeline and Contacts are one page per book. The nav's single link lands
// here: the page follows the business switch, and on All a Bayway | MPG toggle
// picks the book (remembered on this device). The old per-book routes
// (/bayway/pipeline, /mpg/contacts…) still render their book directly.
import { useState } from 'react'
import { useBusiness } from '../context/BusinessContext'

const BOOKS = [
  ['bay', 'Bayway'],
  ['mpg', 'MPG'],
]
const KEY = 'book-pick'

function remembered() {
  try {
    return localStorage.getItem(KEY) === 'mpg' ? 'mpg' : 'bay'
  } catch {
    return 'bay'
  }
}

export default function BookPage({ page: Page }) {
  const filter = useBusiness()?.biz || 'all'
  const [pick, setPick] = useState(remembered)
  const book = filter === 'all' ? pick : filter
  const choose = (b) => {
    setPick(b)
    try {
      localStorage.setItem(KEY, b)
    } catch {
      /* private window: the pick lasts for this visit */
    }
  }
  return (
    <>
      {filter === 'all' && (
        <div role="tablist" aria-label="Book" className="mb-4 inline-flex rounded-[10px] bg-panel2 p-1">
          {BOOKS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={book === id}
              onClick={() => choose(id)}
              className={`flex min-h-[32px] items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold ${
                book === id ? 'bg-panel text-[color:var(--text)] shadow-sm' : 'text-muted'
              }`}
            >
              <span className="h-[7px] w-[7px] rounded-full" style={{ background: `var(--${id}-ink)` }} />
              {label}
            </button>
          ))}
        </div>
      )}
      <Page key={book} biz={book} />
    </>
  )
}
