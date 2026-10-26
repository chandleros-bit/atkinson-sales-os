// "+ Work item" and the voice quick-add confirm sheet: your own task, by
// default a Workbench item (a custom work_items row, dashboard only) with an
// optional lead and due day. With a lead picked it can instead be a CRM task
// (FollowUpBoss for Bayway, Zoho for MPG) through crm-action create_task.
//
// initial (voice): { heard, title, book, dueOn, names } from parseVoiceTask;
// each spoken name is looked up as a lead in that book and offered to link.
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useSearch } from '../lib/useSearch'
import { addWorkItem } from '../lib/workItems'
import { buildActionRequest, followUpDate, localDateKey, summarizeResult } from '../lib/crmActions'
import { invokeCrmAction, useWritebackFlags } from '../lib/writeback'
import { dueLabel } from '../lib/tasks'
import BizBadge from './BizBadge'
import { Sheet, quickActionTone } from './QuickActions'
import { showToast } from './Toaster'

const BOOKS = [
  ['bay', 'Bayway'],
  ['mpg', 'MPG'],
]
const CRM = { bay: 'FollowUpBoss', mpg: 'Zoho' }
const DUE = [
  ['none', 'No date'],
  ['today', 'Today'],
  ['tomorrow', 'Tomorrow'],
  ['pick', 'Pick'],
]

const chip = (on) =>
  on ? { borderColor: 'var(--text)', color: 'var(--text)' } : { borderColor: 'var(--line2)', color: 'var(--muted)' }
const personLabel = (p) => (p.business_id === 'mpg' && p.company ? `${p.company} · ${p.name}` : p.name)

// Leads whose first or last name is one of the spoken names, in this book.
function useNameMatches(names, book, off) {
  const [matches, setMatches] = useState([])
  const key = (names || []).join('|')
  useEffect(() => {
    if (off || !key) {
      setMatches([])
      return undefined
    }
    let live = true
    Promise.all(
      key.split('|').map((q) => supabase.rpc('search_people', { q, prefer: book, max_rows: 3 }).then((r) => r.data || [])),
    ).then((lists) => {
      if (!live) return
      const seen = new Set()
      const out = []
      key.split('|').forEach((name, i) => {
        for (const p of lists[i]) {
          const parts = String(p.name || '').toLowerCase().split(/\s+/)
          if (p.business_id === book && parts.includes(name.toLowerCase()) && !seen.has(p.id)) {
            seen.add(p.id)
            out.push(p)
          }
        }
      })
      setMatches(out.slice(0, 3))
    })
    return () => {
      live = false
    }
  }, [key, book, off])
  return matches
}

export default function AddWorkItem({ defaultBook = 'bay', initial = null, onClose, onAdded }) {
  const flags = useWritebackFlags()
  const [book, setBook] = useState(initial?.book || defaultBook)
  const [title, setTitle] = useState(initial?.title || '')
  const [query, setQuery] = useState('')
  const [lead, setLead] = useState(null)
  const [notes, setNotes] = useState('')
  const today = localDateKey(new Date())
  const [due, setDue] = useState(() => {
    if (!initial?.dueOn) return 'none'
    if (initial.dueOn === today) return 'today'
    return initial.dueOn === followUpDate('tomorrow', new Date()) ? 'tomorrow' : 'pick'
  })
  const [picked, setPicked] = useState(initial?.dueOn || '')
  const [saveTo, setSaveTo] = useState('workbench')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const { people } = useSearch(lead ? '' : query, book)
  const suggested = useNameMatches(initial?.names, book, !!lead)

  const canCrm = !!lead && flags[book] === true
  const toCrm = saveTo === 'crm' && canCrm

  // Tomorrow skips the weekend, like every follow-up in the app.
  const dueOn = () => (due === 'none' ? null : due === 'today' ? today : followUpDate(due, new Date(), picked))

  const add = async () => {
    if (busy) return
    if (!title.trim()) return setError('Say what the work is.')
    let day
    try {
      day = dueOn()
    } catch {
      return setError('Pick the due day.')
    }
    setBusy(true)
    setError(null)
    if (toCrm) {
      // CRM tasks need a due day; none said = today.
      const res = await invokeCrmAction(buildActionRequest({ action: 'create_task', contactId: lead.id, title: title.trim(), dueDate: day || today }))
      setBusy(false)
      const summary = summarizeResult(res, book)
      if (summary.tone === 'error') return setError(summary.text)
      showToast(summary.tone === 'ok' ? { tone: 'ok', text: `Task added in ${CRM[book]}: ${title.trim()}` } : summary)
      return onAdded()
    }
    const { error: err } = await addWorkItem({ book, title, contactId: lead?.id || null, notes, dueOn: day })
    setBusy(false)
    if (err) return setError(err.message)
    const when = day && dueLabel(day)
    showToast({ tone: 'ok', text: `Added: ${title.trim()}${when ? ` · due ${/^To/.test(when) ? when.toLowerCase() : when}` : ''}` })
    onAdded()
  }

  const pickLead = (p) => {
    setLead(p)
    setBook(p.business_id)
  }

  const field = 'w-full rounded-[10px] border border-line2 bg-panel px-3 py-2 text-[13px]'
  return (
    <Sheet title={initial ? 'New task from voice' : 'New work item'} subtitle={toCrm ? `Saved as a ${CRM[book]} task` : 'Saved in the dashboard only'} t={quickActionTone(book)} onClose={onClose}>
      <div className="flex flex-col gap-3">
        {initial?.heard && <div className="rounded-[10px] bg-panel2 px-3 py-2 text-[12.5px] italic text-muted">Heard: “{initial.heard}”</div>}
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
              style={chip(book === k)}
            >
              {label}
            </button>
          ))}
        </div>
        <div>
          <div className="mb-1.5 text-[12px] font-semibold text-muted">Due</div>
          <div className="grid grid-cols-4 gap-2">
            {DUE.map(([k, label]) => (
              <button key={k} type="button" aria-pressed={due === k} onClick={() => setDue(k)} className="min-h-[36px] rounded-[10px] border text-[12.5px] font-semibold" style={chip(due === k)}>
                {label}
              </button>
            ))}
          </div>
          {due === 'pick' && <input type="date" aria-label="Due on" value={picked} onChange={(e) => setPicked(e.target.value)} className={`${field} mt-2`} />}
        </div>
        {lead ? (
          <div className="flex items-center justify-between gap-2 rounded-[10px] border border-line2 px-3 py-2 text-[13px]">
            <span className="flex min-w-0 items-center gap-2">
              <BizBadge biz={lead.business_id} />
              <span className="truncate font-semibold">{personLabel(lead)}</span>
            </span>
            <button
              type="button"
              onClick={() => {
                setLead(null)
                setSaveTo('workbench')
              }}
              className="text-[12.5px] font-semibold text-muted"
            >
              Change
            </button>
          </div>
        ) : (
          <div>
            {suggested.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {suggested.map((p) => (
                  <button key={p.id} type="button" onClick={() => pickLead(p)} className="min-h-[36px] rounded-[10px] border border-line2 px-3 text-[12.5px] font-semibold">
                    Link to {personLabel(p)}?
                  </button>
                ))}
              </div>
            )}
            <input aria-label="Lead (optional)" placeholder="Lead (optional): search by name or phone" value={query} onChange={(e) => setQuery(e.target.value)} className={field} />
            {people.length > 0 && (
              <div className="mt-1 overflow-hidden rounded-[10px] border border-line">
                {people.slice(0, 5).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => pickLead(p)}
                    className="flex w-full items-center gap-2 border-b border-line px-3 py-2 text-left text-[13px] last:border-b-0 hover:bg-hoverbg"
                  >
                    <BizBadge biz={p.business_id} />
                    <span className="truncate">{personLabel(p)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {lead && (
          <div>
            <div className="mb-1.5 text-[12px] font-semibold text-muted">Save to</div>
            <div className="grid grid-cols-2 gap-2">
              {[
                ['workbench', 'Workbench'],
                ['crm', `${CRM[book]} task`],
              ].map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={saveTo === k}
                  disabled={k === 'crm' && !canCrm}
                  onClick={() => setSaveTo(k)}
                  className="min-h-[40px] rounded-[10px] border text-[12.5px] font-semibold disabled:opacity-50"
                  style={chip(saveTo === k)}
                >
                  {label}
                </button>
              ))}
            </div>
            {!canCrm && <div className="mt-1 text-[12px] text-muted">Write-back to {CRM[book]} is off.</div>}
          </div>
        )}
        {!toCrm && <textarea aria-label="Work item notes" placeholder="Notes (optional)" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={field} />}
        {error && <div className="text-[12px] text-[color:var(--neg-ink)]">{error}</div>}
        <button type="button" disabled={busy} onClick={add} className="min-h-[44px] rounded-[10px] text-[13.5px] font-semibold text-white disabled:opacity-50" style={{ background: 'var(--text)' }}>
          Add
        </button>
      </div>
    </Sheet>
  )
}
