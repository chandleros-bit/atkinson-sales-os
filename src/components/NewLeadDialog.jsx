// "+ New -> New lead…": create a lead in FollowUpBoss (Bayway) or Zoho (MPG).
// Before any write it looks for the same phone or email in that book and
// offers to open the match instead. crm-action create_contact does the write
// and mirrors the new lead back, so its person sheet can open straight away.
// Spec: docs/superpowers/specs/2026-10-19-tier1-pipeline-flow-design.md (5)
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { invokeCrmAction } from '../lib/writeback'
import { buildActionRequest, summarizeResult, newLeadProblem, CRM_LABEL } from '../lib/crmActions'
import { digitsOf } from '../lib/search'
import { Sheet, quickActionTone } from './QuickActions'
import { showToast } from './Toaster'

const BOOK = { bay: 'Bayway', mpg: 'MPG' }
const inputCls = 'w-full rounded-[10px] border border-line2 bg-panel px-3 py-2 text-[13px] text-[color:var(--text)]'
const DUP_DEBOUNCE_MS = 250

// The same lead in this book: identical phone digits or email.
function sameLead(p, book, digits, email) {
  if (p.business_id !== book) return false
  if (digits && digitsOf(p.phone) === digits) return true
  return !!email && String(p.email || '').toLowerCase() === email
}

// books: the books creating is on for; onOpen(id): open an existing lead.
export default function NewLeadDialog({ books, defaultBook, onClose, onCreated, onOpen }) {
  const [book, setBook] = useState(books.includes(defaultBook) ? defaultBook : books[0])
  const [form, setForm] = useState({ firstName: '', lastName: '', phone: '', email: '', company: '', note: '' })
  const [dup, setDup] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const seq = useRef(0)
  const t = quickActionTone(book)
  const crm = CRM_LABEL[book]

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  // Look for the same phone (7+ digits) or email before creating another.
  const digits = digitsOf(form.phone)
  const email = form.email.trim().toLowerCase()
  const q = digits.length >= 7 ? digits : email.includes('@') ? email : ''
  useEffect(() => {
    const mine = ++seq.current
    setDup(null)
    if (!q) return undefined
    const id = setTimeout(async () => {
      try {
        const { data } = await supabase.rpc('search_people', { q, prefer: book, max_rows: 5 })
        if (mine !== seq.current) return
        setDup((data || []).find((p) => sameLead(p, book, digits.length >= 7 ? digits : '', email)) || null)
      } catch {
        // No duplicate check is not a reason to block the form.
      }
    }, DUP_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [q, book, digits, email])

  const problem = newLeadProblem({ businessId: book, ...form })

  const create = async () => {
    if (busy || problem) return
    setBusy(true)
    setError(null)
    let res
    try {
      res = await invokeCrmAction(buildActionRequest({ action: 'create_contact', businessId: book, ...form }))
    } catch (e) {
      res = { status: 'error', error: String(e?.message || e) }
    }
    setBusy(false)
    const summary = summarizeResult(res, book)
    const made = Array.isArray(res?.results) ? res.results.find((r) => r.step === 'create_contact' && r.ok) : null
    if (!made) {
      setError(summary.text)
      return
    }
    showToast(made.existing ? { tone: 'ok', text: `Already in ${crm}: opened it`, failed: [] } : summary)
    onCreated(made.contact_id || null)
  }

  return (
    <Sheet title="New lead" subtitle={`Creates the lead in ${crm}`} t={t} onClose={onClose}>
      {books.length > 1 && (
        <div className="mb-3 flex gap-2" role="group" aria-label="Book">
          {books.map((b) => (
            <button
              key={b}
              type="button"
              aria-pressed={book === b}
              onClick={() => setBook(b)}
              className="min-h-[40px] flex-1 rounded-[10px] border px-3 text-[13px] font-semibold"
              style={book === b ? { borderColor: t.accent, background: t.soft, color: t.ink } : { borderColor: 'var(--line2)', color: 'var(--muted)' }}
            >
              {BOOK[b]}
            </button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <input aria-label="First name" placeholder="First name" value={form.firstName} onChange={set('firstName')} className={inputCls} />
        <input aria-label="Last name" placeholder="Last name" value={form.lastName} onChange={set('lastName')} className={inputCls} />
      </div>
      {book === 'mpg' && (
        <input aria-label="Company" placeholder="Company" value={form.company} onChange={set('company')} className={`${inputCls} mt-2`} />
      )}
      <input aria-label="Phone" placeholder="Phone" inputMode="tel" value={form.phone} onChange={set('phone')} className={`${inputCls} mt-2`} />
      <input aria-label="Email" placeholder="Email" type="email" value={form.email} onChange={set('email')} className={`${inputCls} mt-2`} />
      <textarea aria-label="Note" placeholder="Note (optional)" rows={2} value={form.note} onChange={set('note')} className={`${inputCls} mt-2`} />

      {dup && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-[10px] border px-3 py-2 text-[12.5px]" style={{ borderColor: 'var(--bay-gold)' }}>
          <span>
            Already in {crm}: <span className="font-semibold">{dup.name || 'this lead'}</span>
          </span>
          <button type="button" onClick={() => onOpen(dup.id)} className="min-h-[36px] rounded-md border border-line2 px-2.5 font-semibold">
            Open
          </button>
        </div>
      )}
      {problem && <div className="mt-2 text-[12px] text-muted">{problem}</div>}
      {error && (
        <div role="alert" className="mt-3 rounded-[10px] px-3 py-2 text-[12.5px] font-semibold" style={{ background: 'var(--neg-bg)', color: 'var(--neg-ink)' }}>
          {error}
        </div>
      )}
      <button
        type="button"
        disabled={busy || !!problem}
        onClick={create}
        className="mt-4 flex min-h-[42px] w-full items-center justify-center rounded-[10px] text-[13.5px] font-bold text-white disabled:opacity-50"
        style={{ background: t.accent }}
      >
        {busy ? 'Creating…' : dup ? 'Create anyway' : 'Create lead'}
      </button>
    </Sheet>
  )
}
