// HAR CSV import on the Partners tab: pick the file, read the preview,
// confirm. Same flow as the Arive import. Parsing, scoring and matching are
// pure (lib/csv.js, lib/harImport.js).
import { useState } from 'react'
import { parseCsv } from '../lib/csv'
import { buildHarPreview, saveHarImport, templateCsv } from '../lib/harImport'

export default function HarImport({ partners, onClose, onImported }) {
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function pick(e) {
    const input = e.target
    const file = input.files?.[0]
    if (!file) return
    setError(null)
    setPreview(null)
    try {
      const { header, rows } = parseCsv(await file.text())
      input.value = ''
      const p = buildHarPreview({ header, rows, partners })
      if (p.error) setError(p.error)
      else setPreview(p)
    } catch (err) {
      setError(String(err?.message || err))
    }
  }

  async function confirm() {
    setBusy(true)
    const { error: err } = await saveHarImport(preview)
    setBusy(false)
    if (err) { setError(err.message); return }
    onImported(preview.counts)
  }

  const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(templateCsv())}`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div role="dialog" aria-modal="true" aria-label="Import HAR agents" className="w-full max-w-[480px] rounded-card border border-line bg-panel p-5">
        <div className="text-ui font-semibold">Import HAR agents</div>
        <p className="mt-1 text-body text-muted">
          One row per agent from their HAR.com profile: closings and volume for the last 12 months, average price, buyer-side share, areas and any preferred lender.{' '}
          <a href={templateHref} download="har-agents-template.csv" className="text-link">Download the template</a>.
        </p>
        <input type="file" accept=".csv,text/csv" aria-label="HAR CSV" autoFocus onChange={pick} disabled={busy} className="mt-3 block w-full text-body" />
        {error && <div className="mt-3 rounded-lg border border-neg-line bg-neg-bg px-3 py-2 text-xs text-neg-ink">{error}</div>}
        {preview && (
          <ul data-har-preview className="mt-4 space-y-0.5 text-body">
            <li><span className="num font-semibold">{preview.counts.new}</span> new agents (added as Prospects)</li>
            <li><span className="num font-semibold">{preview.counts.updated}</span> already on Partners (HAR numbers and score updated)</li>
            {preview.counts.skipped > 0 && <li><span className="num font-semibold">{preview.counts.skipped}</span> rows skipped (no name or repeated)</li>}
          </ul>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="min-h-[32px] rounded-lg border border-line2 px-3 text-body font-semibold disabled:opacity-40">Cancel</button>
          <button type="button" onClick={confirm} disabled={!preview || busy || !preview.counts.total}
            className="min-h-[32px] rounded-lg bg-[color:var(--text)] px-3 text-body font-semibold text-white disabled:opacity-40">
            {busy ? 'Importing…' : `Import ${preview ? preview.counts.total : ''} agents`}
          </button>
        </div>
      </div>
    </div>
  )
}
