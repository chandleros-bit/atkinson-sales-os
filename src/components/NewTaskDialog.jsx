// Sidebar "+ New Task": pick a contact, then schedule a follow-up in its CRM.
// The picker searches contacts server-side (ilike on name, 10 rows, only the
// books with write-back on), so it never loads the whole table.
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useWritebackFlags } from '../lib/writeback'
import { FollowUpForm, quickActionTone } from './QuickActions'
import { showToast } from './Toaster'

// PostgREST filter syntax uses , ( ) and ilike uses % _ as wildcards.
const cleanQuery = (q) => q.replace(/[%_,()*\\]/g, ' ').trim()

export default function NewTaskDialog({ onClose }) {
  const flags = useWritebackFlags()
  const books = Object.keys(flags).filter((k) => flags[k] === true)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [contact, setContact] = useState(null)

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const booksKey = books.join(',')
  useEffect(() => {
    const q = cleanQuery(query)
    if (q.length < 2 || !booksKey) {
      setResults([])
      return undefined
    }
    let alive = true
    setSearching(true)
    const id = setTimeout(async () => {
      const { data } = await supabase
        .from('contacts')
        .select('id, name, company, business_id')
        .ilike('name', `%${q}%`)
        .in('business_id', booksKey.split(','))
        .order('name')
        .limit(10)
      if (!alive) return
      setResults(data || [])
      setSearching(false)
    }, 250)
    return () => {
      alive = false
      clearTimeout(id)
    }
  }, [query, booksKey])

  const t = contact ? quickActionTone(contact.business_id) : null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label="New task"
        className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl border border-line bg-panel p-5 sm:max-w-md sm:rounded-card"
        style={t ? { borderTop: `3px solid ${t.accent}` } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[15px] font-bold">New task</div>
            {contact && (
              <div className="truncate text-[12px] text-muted">
                {contact.name} · {contact.business_id === 'mpg' ? 'Zoho' : 'FollowUpBoss'}
              </div>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-10 w-10 place-items-center rounded-[10px] text-muted hover:bg-hoverbg">
            ✕
          </button>
        </div>

        {!contact && books.length === 0 && (
          <div className="text-[13px] text-muted">Write-back is off for both books.</div>
        )}

        {!contact && books.length > 0 && (
          <>
            <input
              autoFocus
              aria-label="Search contacts"
              placeholder="Search contacts by name…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full rounded-[10px] border border-line2 bg-panel px-3 py-2 text-[13px] text-[color:var(--text)]"
            />
            <div className="mt-2 flex flex-col">
              {searching && <div className="px-1 py-2 text-[12px] text-dim">Searching…</div>}
              {!searching && cleanQuery(query).length >= 2 && results.length === 0 && (
                <div className="px-1 py-2 text-[12px] text-dim">No matches.</div>
              )}
              {results.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setContact(c)}
                  className="flex min-h-[40px] items-center gap-2 rounded-[10px] px-2 text-left text-[13px] hover:bg-hoverbg"
                >
                  <span
                    className="h-[7px] w-[7px] flex-none rounded-full"
                    style={{ background: c.business_id === 'mpg' ? 'var(--mpg)' : 'var(--bay)' }}
                  />
                  <span className="truncate font-semibold">{c.name || '(no name)'}</span>
                  {c.company && <span className="truncate text-muted">· {c.company}</span>}
                </button>
              ))}
            </div>
          </>
        )}

        {contact && (
          <>
            <FollowUpForm
              businessId={contact.business_id}
              contactId={contact.id}
              contactName={contact.name}
              t={t}
              onSuccess={(summary, { keepOpen } = {}) => {
                if (keepOpen) return
                showToast(summary)
                onClose()
              }}
            />
            <button type="button" onClick={() => setContact(null)} className="mt-2 min-h-[40px] w-full text-[12.5px] text-muted hover:text-[color:var(--text)]">
              ← Pick a different contact
            </button>
          </>
        )}
      </div>
    </div>
  )
}
