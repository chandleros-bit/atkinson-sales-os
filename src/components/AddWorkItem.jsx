// "+ Work item": your own task on the Workbench (a custom work_items row),
// optionally tied to a lead found by search. Dashboard only, never the CRM.
import { useState } from 'react'
import { useSearch } from '../lib/useSearch'
import { addWorkItem } from '../lib/workItems'
import BizBadge from './BizBadge'
import { Sheet, quickActionTone } from './QuickActions'
import { showToast } from './Toaster'

const BOOKS = [
  ['bay', 'Bayway'],
  ['mpg', 'MPG'],
]

export default function AddWorkItem({ defaultBook = 'bay', onClose, onAdded }) {
  const [book, setBook] = useState(defaultBook)
  const [title, setTitle] = useState('')
  const [query, setQuery] = useState('')
  const [lead, setLead] = useState(null)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const { people } = useSearch(lead ? '' : query, book)

  const add = async () => {
    if (busy) return
    if (!title.trim()) {
      setError('Say what the work is.')
      return
    }
    setBusy(true)
    setError(null)
    const { error: err } = await addWorkItem({ book, title, contactId: lead?.id || null, notes })
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    showToast({ tone: 'ok', text: `Added: ${title.trim()}` })
    onAdded()
  }

  const field = 'w-full rounded-[10px] border border-line2 bg-panel px-3 py-2 text-[13px]'
  return (
    <Sheet title="New work item" subtitle="Saved in the dashboard only" t={quickActionTone(book)} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <input aria-label="Work item title" placeholder="What needs doing, e.g. Order appraisal" value={title} onChange={(e) => setTitle(e.target.value)} className={field} />
        <div className="grid grid-cols-2 gap-2">
          {BOOKS.map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-pressed={book === k}
              onClick={() => {
                setBook(k)
                setLead(null)
              }}
              className="min-h-[40px] rounded-[10px] border text-[12.5px] font-semibold"
              style={book === k ? { borderColor: 'var(--text)', color: 'var(--text)' } : { borderColor: 'var(--line2)', color: 'var(--muted)' }}
            >
              {label}
            </button>
          ))}
        </div>
        {lead ? (
          <div className="flex items-center justify-between gap-2 rounded-[10px] border border-line2 px-3 py-2 text-[13px]">
            <span className="flex min-w-0 items-center gap-2">
              <BizBadge biz={lead.business_id} />
              <span className="truncate font-semibold">{lead.name}</span>
            </span>
            <button type="button" onClick={() => setLead(null)} className="text-[12.5px] font-semibold text-muted">
              Change
            </button>
          </div>
        ) : (
          <div>
            <input aria-label="Lead (optional)" placeholder="Lead (optional): search by name or phone" value={query} onChange={(e) => setQuery(e.target.value)} className={field} />
            {people.length > 0 && (
              <div className="mt-1 overflow-hidden rounded-[10px] border border-line">
                {people.slice(0, 5).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setLead(p)
                      setBook(p.business_id)
                    }}
                    className="flex w-full items-center gap-2 border-b border-line px-3 py-2 text-left text-[13px] last:border-b-0 hover:bg-hoverbg"
                  >
                    <BizBadge biz={p.business_id} />
                    <span className="truncate">{p.business_id === 'mpg' && p.company ? `${p.company} · ${p.name}` : p.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <textarea aria-label="Work item notes" placeholder="Notes (optional)" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={field} />
        {error && <div className="text-[12px] text-[color:var(--neg-ink)]">{error}</div>}
        <button type="button" disabled={busy} onClick={add} className="min-h-[44px] rounded-[10px] text-[13.5px] font-semibold text-white disabled:opacity-50" style={{ background: 'var(--text)' }}>
          Add
        </button>
      </div>
    </Sheet>
  )
}
