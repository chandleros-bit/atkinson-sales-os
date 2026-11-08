// Reports → Daily tracker (MPG): the day's visits as rows for the manager's
// workbook, copied to the clipboard and pasted into "Chandler Visits" (A–M).
// Later slices add the Follow-ups and ISV blocks and the cold-calls line.
import { useCallback, useEffect, useRef, useState } from 'react'
import { visitRow, toTsv, newSinceCopy, readCopied, writeCopied, OUTCOMES } from '../lib/mpgTracker'
import { fetchTouchesForDay, onTouchesChanged } from '../lib/mpgTouches'
import { localDateKey } from '../lib/crmActions'
import LogVisitDialog from './LogVisitDialog'
import ZohoPromote from './ZohoPromote'
import { showToast } from './Toaster'

const clock = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
const zohoState = (r) => {
  if (r.contact_id || r.mpg_prospects?.status === 'promoted') return 'in'
  return r.mpg_prospects?.zoho_wanted ? 'retry' : null
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

export default function DailyTracker({ initialDay }) {
  const [day, setDay] = useState(initialDay || localDateKey(new Date()))
  const [rows, setRows] = useState([])
  const [error, setError] = useState(null)
  const [copiedAt, setCopiedAt] = useState(null)
  const [fallback, setFallback] = useState(null)
  const [editing, setEditing] = useState(null)
  const [retrying, setRetrying] = useState(null) // the touch whose Zoho promotion is being retried
  const downOnBackdrop = useRef(false)
  const closeRetry = useCallback(() => setRetrying(null), [])

  useEffect(() => {
    if (!retrying) return undefined
    // Capture phase + stopPropagation, like LogVisitDialog: Esc closes only this modal.
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      closeRetry()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [retrying, closeRetry])

  const requestId = useRef(0)
  const load = useCallback(async () => {
    const id = ++requestId.current
    try {
      const { data, error: err } = await fetchTouchesForDay(day, 'walk_in')
      if (id !== requestId.current) return // a newer load superseded this one
      setError(err ? err.message : null)
      setRows(data || [])
      setCopiedAt(readCopied(day, 'visits'))
    } catch (e) {
      if (id !== requestId.current) return
      setError(e?.message || 'Could not load visits')
      setRows([])
    }
  }, [day])

  useEffect(() => {
    // Drop the previous day's rows right away so they can't be copied as this day.
    setRows([])
    setCopiedAt(null)
    setFallback(null)
    setError(null)
    load()
    const off = onTouchesChanged(load)
    return () => { off(); requestId.current++ }
  }, [load])

  const fresh = copiedAt ? newSinceCopy(rows, copiedAt.through) : []

  async function copy(list) {
    const text = toTsv(list.map(visitRow))
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard')
      await navigator.clipboard.writeText(text)
      // through: server time of the newest copied row, so "new since copy" never
      // depends on this browser's clock. at: the click time, shown to the user.
      const through = list.reduce((m, r) => (r.created_at > m ? r.created_at : m), list[0].created_at)
      const stamp = { through, at: new Date().toISOString() }
      writeCopied(day, 'visits', stamp)
      setCopiedAt(stamp)
      setFallback(null)
      showToast({ tone: 'ok', text: `Copied ${plural(list.length, 'row')}` })
    } catch {
      setFallback(text)
      showToast({ tone: 'error', text: "Couldn't copy — select the rows below and copy them by hand" })
    }
  }

  return (
    <section className="mt-5">
      <label className="mb-4 flex items-center gap-2 text-[13px] font-semibold">
        Day
        <input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} className="rounded-[10px] border border-line2 bg-panel px-3 py-1.5 text-[13px]" />
      </label>
      {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <div className="rounded-card border border-line bg-panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[14px] font-bold">Chandler Visits <span className="font-normal text-muted">· {plural(rows.length, 'row')}</span></div>
          {rows.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {fresh.length > 0 && (
                <button type="button" onClick={() => copy(fresh)} className="min-h-[40px] rounded-[10px] border border-line2 px-3 text-[13px] font-semibold">
                  Copy new rows only ({fresh.length})
                </button>
              )}
              <button type="button" onClick={() => copy(rows)} className="btn-primary min-h-[40px] rounded-[10px] px-3 text-[13px] font-semibold">
                Copy rows ({rows.length})
              </button>
            </div>
          )}
        </div>
        {copiedAt && (
          <div className="mt-1 text-[12px] text-muted">
            Copied{copiedAt.at ? ` ${clock(copiedAt.at)}` : ''}{fresh.length > 0 ? ` · ${plural(fresh.length, 'row')} logged since` : ''}
          </div>
        )}
        {rows.length === 0 ? (
          <div className="mt-3 text-[13px] text-muted">No visits logged for this day.</div>
        ) : (
          <>
            <div className="mt-1 text-[12px] text-dim">Click the first empty yellow cell in column A of Chandler Visits, then paste.</div>
            <ul className="mt-3 divide-y divide-line">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-2">
                  <button type="button" onClick={() => setEditing(r)} className="flex min-h-[44px] min-w-0 flex-1 basis-48 items-center gap-2 px-1 text-left text-[13px] hover:bg-hoverbg">
                    <span className="min-w-0 truncate font-semibold">{r.business_name}</span>
                    {r.contact_label && <span className="min-w-0 truncate text-muted">· {r.contact_label}</span>}
                    {r.temperature && <span className="text-muted">· {r.temperature[0].toUpperCase() + r.temperature.slice(1)}</span>}
                    <span className="ml-auto min-w-0 truncate text-[12px] text-dim">{OUTCOMES.filter((o) => r[o.key]).map((o) => o.label).join(', ')}</span>
                  </button>
                  {zohoState(r) === 'in' && <span className="px-1 text-[12px] font-semibold text-[color:var(--pos-ink)]">In Zoho</span>}
                  {zohoState(r) === 'retry' && (
                    <span className="flex items-center gap-1 px-1 text-[12px] text-muted">
                      Not in Zoho yet ·
                      <button type="button" onClick={() => setRetrying(r)} className="min-h-[40px] rounded-[10px] px-2 text-[12px] font-semibold underline">Retry</button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
        {fallback && <textarea readOnly rows={4} value={fallback} className="mt-3 w-full rounded-[10px] border border-line2 bg-panel p-2 font-mono text-[11px]" onFocus={(e) => e.target.select()} />}
      </div>
      {retrying && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget }}
          onClick={(e) => { if (downOnBackdrop.current && e.target === e.currentTarget) closeRetry() }}>
          <div role="dialog" aria-modal="true" aria-label="Add to Zoho" className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl border border-line bg-panel p-5 sm:max-w-md sm:rounded-card">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="text-[15px] font-bold">Add to Zoho</div>
              <button type="button" onClick={closeRetry} aria-label="Close" className="grid h-10 w-10 place-items-center rounded-[10px] text-muted hover:bg-hoverbg">✕</button>
            </div>
            <ZohoPromote prospectId={retrying.prospect_id} touch={retrying} onDone={closeRetry} />
          </div>
        </div>
      )}
      {editing && <LogVisitDialog touch={editing} onClose={() => setEditing(null)} />}
    </section>
  )
}
