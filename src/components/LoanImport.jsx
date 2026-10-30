// Arive CSV import: pick the export, read the preview, confirm. Parsing and
// the preview are pure (lib/csv.js, lib/ariveImport.js); saving is
// lib/loansData.js.
import { useState } from 'react'
import { parseCsv } from '../lib/csv'
import { buildPreview } from '../lib/ariveImport'
import { fetchBayContacts, saveImport } from '../lib/loansData'

const LINES = [
  ['new', 'new loans'],
  ['updated', 'updated'],
  ['unchanged', 'unchanged'],
  ['scenario', 'scenario files (hidden by default)'],
  ['unmatched', 'not matched to a contact'],
  ['missing', 'in the OS but not in this file (kept)'],
  ['skipped', 'rows skipped (no loan ID or repeated)'],
]

export default function LoanImport({ existing, rates, onClose, onImported }) {
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  // Set when the loans saved but the sync_log insert failed.
  const [warning, setWarning] = useState(null)

  async function pick(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    setPreview(null)
    setBusy(true)
    try {
      const { header, rows } = parseCsv(await file.text())
      const contacts = await fetchBayContacts()
      if (contacts.error) throw contacts.error
      const p = buildPreview({ header, rows, existing, contacts: contacts.data || [], loName: rates.lo_name })
      if (p.error) setError(p.error)
      else setPreview(p)
    } catch (err) {
      setError(String(err?.message || err))
    } finally {
      setBusy(false)
    }
  }

  async function confirm() {
    setBusy(true)
    const { error: err, warning: warn } = await saveImport(preview)
    setBusy(false)
    if (err) { setError(err.message); return }
    // The loans are in, so the page still reloads, but only once the warning
    // has been read: the parent closes this dialog in onImported.
    if (warn) { setWarning(warn); return }
    onImported()
  }

  return (
    <div role="dialog" aria-label="Import Arive loans" className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-[460px] rounded-card border border-line bg-panel p-5">
        <div className="text-[15px] font-semibold">Import Arive loans</div>
        <p className="mt-1 text-[12.5px] text-muted">Export the saved “OS – Loan Export” Pipeline Report from Arive as CSV and pick it here.</p>
        <input type="file" accept=".csv,text/csv" onChange={pick} disabled={busy || !!warning} className="mt-3 block w-full text-[13px]" />
        {busy && <div className="mt-3 text-[12.5px] text-muted">Working…</div>}
        {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
        {warning && (
          <div role="status" className="mt-3 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'var(--warn-line)', background: 'var(--warn-bg)', color: 'var(--warn-ink)' }}>
            {warning}
          </div>
        )}
        {preview && (
          <div className="mt-4 text-[13px]">
            <div className="font-semibold">{preview.counts.total} loans in this file</div>
            <ul className="mt-2 space-y-0.5">
              {LINES.filter(([k]) => preview.counts[k] > 0).map(([k, label]) => (
                <li key={k}><span className="num font-semibold">{preview.counts[k]}</span> {label}</li>
              ))}
            </ul>
            {preview.unknownStages.length > 0 && (
              <div className="mt-2 text-[12px] text-[color:var(--bay-gold)]">Unknown stages (imported as Other): {preview.unknownStages.join(', ')}</div>
            )}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          {warning ? (
            <button type="button" onClick={() => onImported()} className="min-h-[32px] rounded-[9px] bg-[color:var(--text)] px-3 text-[13px] font-semibold text-white">Done</button>
          ) : (
            <>
              <button type="button" onClick={onClose} className="min-h-[32px] rounded-[9px] border border-line2 px-3 text-[13px] font-semibold">Cancel</button>
              <button
                type="button"
                onClick={confirm}
                disabled={!preview || busy}
                className="min-h-[32px] rounded-[9px] bg-[color:var(--text)] px-3 text-[13px] font-semibold text-white disabled:opacity-40"
              >
                Import {preview ? preview.counts.total : ''} loans
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
