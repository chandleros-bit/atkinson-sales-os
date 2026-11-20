// Power Dialer upload (spec 2026-11-20, "Upload and map"): pick the file and
// the business, confirm the column mapping against a 3-row preview, read the
// check summary, save. Nothing here touches Zoho or FUB.
import { useState } from 'react'
import Segmented from './Segmented'
import { parseCsv } from '../lib/csv'
import { FIELDS, autoMap, buildLeads, listNameFrom, mappingError, normalizePhone } from '../lib/dialerImport'
import { fetchDncSet, saveList } from '../lib/dialerData'
import { formatPhone } from '../lib/phone'

const primary = 'min-h-[44px] flex-1 rounded-lg bg-[color:var(--text)] px-4 text-body font-semibold text-white disabled:opacity-40'
const quiet = 'min-h-[44px] rounded-lg border border-line2 px-4 text-body font-semibold text-ink2'
const field = 'mt-1 block w-full min-h-[40px] rounded-lg border border-line2 bg-panel px-3 text-body'

const SUMMARY = [
  ['total', 'Rows in the file'],
  ['ready', 'Ready to dial'],
  ['dnc', 'On the Do Not Call list (saved, never dialed)'],
  ['badPhone', 'No valid phone (saved, never dialed)'],
  ['inFileDupes', 'Repeat numbers in the file (left out)'],
]

function Label({ children }) {
  return <div className="text-caption font-semibold uppercase tracking-[.4px] text-dim">{children}</div>
}

function Bar({ children }) {
  // Thumb-reachable on a phone: the step's buttons sit at the bottom.
  return <div className="sticky bottom-0 -mx-4 mt-2 flex gap-2 border-t border-line bg-panel px-4 py-3 sm:static sm:mx-0 sm:border-0 sm:px-0">{children}</div>
}

export default function DialerUpload({ defaultBiz, userId, onCancel, onSaved }) {
  const [step, setStep] = useState('pick') // pick | map | review
  const [business, setBusiness] = useState(defaultBiz === 'mpg' || defaultBiz === 'bay' ? defaultBiz : null)
  const [temperature, setTemperature] = useState(null)
  const [scrubbed, setScrubbed] = useState(false)
  const [name, setName] = useState('')
  const [file, setFile] = useState(null) // { filename, header, rows }
  const [mapping, setMapping] = useState(null)
  const [result, setResult] = useState(null) // { leads, summary }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const cold = business === 'bay' && temperature === 'cold'
  const pickReady = business && (business === 'mpg' || temperature) && (!cold || scrubbed) && file?.rows.length && name.trim()

  async function pickFile(e) {
    const input = e.target
    const f = input.files?.[0]
    if (!f) return
    setError(null)
    try {
      const { header, rows } = parseCsv(await f.text())
      input.value = ''
      if (!rows.length) {
        setFile(null)
        setError('No rows found in that file.')
        return
      }
      setFile({ filename: f.name, header, rows })
      setMapping(autoMap(header))
      if (!name.trim()) setName(listNameFrom(f.name))
    } catch (err) {
      setError(String(err?.message || err))
    }
  }

  async function check() {
    const problem = mappingError(mapping)
    if (problem) { setError(problem); return }
    setError(null)
    setBusy(true)
    try {
      const phones = file.rows.map((r) => normalizePhone(r[mapping.phone]))
      const dnc = await fetchDncSet(phones)
      setResult(buildLeads({ header: file.header, rows: file.rows, mapping, dnc }))
      setStep('review')
    } catch (err) {
      setError(`Couldn't check the Do Not Call list: ${err?.message || err}`)
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    setError(null)
    setBusy(true)
    const { id, error: err } = await saveList({
      business, temperature, name: name.trim(), filename: file.filename, mapping, leads: result.leads, scrubbedBy: userId,
    })
    setBusy(false)
    if (err) { setError(err.message || String(err)); return }
    onSaved(id)
  }

  const preview = file?.rows.slice(0, 3) || []
  const cell = (row, key) => (mapping?.[key] ? String(row[mapping[key]] ?? '').trim() : '')

  return (
    <section aria-label="Upload a call list" className="flex flex-col gap-4 rounded-card border border-line bg-panel p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-ui font-semibold">
          {step === 'pick' ? 'New call list' : step === 'map' ? 'Match the columns' : 'Check and save'}
        </h2>
        <button type="button" onClick={onCancel} disabled={busy} className="text-body font-semibold text-muted">Cancel</button>
      </div>

      {step === 'pick' && (
        <>
          <div>
            <Label>Business</Label>
            <Segmented label="Business" className="mt-1" options={[['mpg', 'MPG'], ['bay', 'Bayway']]} value={business}
              onChange={(b) => { setBusiness(b); if (b === 'mpg') { setTemperature(null); setScrubbed(false) } }} />
          </div>
          {business === 'bay' && (
            <div>
              <Label>List type</Label>
              <Segmented label="List type" className="mt-1" options={[['cold', 'Cold'], ['warm', 'Warm']]} value={temperature}
                onChange={(t) => { setTemperature(t); if (t === 'warm') setScrubbed(false) }} />
            </div>
          )}
          {cold && (
            <label className="flex items-start gap-2 rounded-lg border px-3 py-2 text-body" style={{ borderColor: 'var(--warn-line)', background: 'var(--warn-bg)', color: 'var(--warn-ink)' }}>
              <input type="checkbox" checked={scrubbed} onChange={(e) => setScrubbed(e.target.checked)} className="mt-1" />
              <span>This list was scrubbed against the National Do Not Call Registry.</span>
            </label>
          )}
          <div>
            <Label>CSV file</Label>
            <input type="file" accept=".csv,text/csv" aria-label="CSV file" onChange={pickFile} className="mt-1 block w-full text-body" />
            {file && <div className="mt-1 text-caption text-muted">{file.filename}: {file.rows.length} rows, {file.header.length} columns</div>}
          </div>
          <label className="block">
            <Label>List name</Label>
            <input type="text" aria-label="List name" value={name} onChange={(e) => setName(e.target.value)} className={field} />
          </label>
        </>
      )}

      {step === 'map' && (
        <>
          <p className="text-body text-muted">Columns were matched automatically. Fix any that are wrong. Unmatched columns are kept and shown on the lead card.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {FIELDS.map((f) => (
              <label key={f.key} className="block">
                <span className="text-body font-semibold">{f.label}{f.required && ' *'}</span>
                <select aria-label={`Column for ${f.label}`} value={mapping[f.key]} className={field}
                  onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value })}>
                  <option value="">Not in this file</option>
                  {file.header.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
            ))}
          </div>
          <div>
            <Label>Preview</Label>
            <div className="mt-1 overflow-x-auto rounded-lg border border-line">
              <table className="w-full text-left text-caption">
                <thead className="bg-panel2 text-dim">
                  <tr>{['Name', 'Company', 'Phone', 'City / State'].map((h) => <th key={h} className="px-2 py-1.5 font-semibold">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {preview.map((row, i) => {
                    const e164 = normalizePhone(cell(row, 'phone'))
                    const person = [cell(row, 'first_name'), cell(row, 'last_name')].filter(Boolean).join(' ') || cell(row, 'full_name')
                    return (
                      <tr key={i} data-preview-row={i} className="border-t border-line">
                        <td className="px-2 py-1.5">{person || '—'}</td>
                        <td className="px-2 py-1.5">{cell(row, 'company') || '—'}</td>
                        <td className="px-2 py-1.5 num">{e164 ? formatPhone(e164.slice(2)) : <span className="text-neg-ink">{cell(row, 'phone') || 'none'}</span>}</td>
                        <td className="px-2 py-1.5">{[cell(row, 'city'), cell(row, 'state')].filter(Boolean).join(', ') || '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {step === 'review' && (
        <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
          {SUMMARY.map(([k, label]) => (
            <li key={k} data-summary={k} className="flex items-center justify-between px-3 py-2 text-body">
              <span>{label}</span>
              <span className="num font-semibold">{result.summary[k]}</span>
            </li>
          ))}
        </ul>
      )}

      {error && <div role="alert" className="rounded-lg border border-neg-line bg-neg-bg px-3 py-2 text-body text-neg-ink">{error}</div>}

      <Bar>
        {step === 'pick' && <button type="button" className={primary} disabled={!pickReady} onClick={() => { setError(null); setStep('map') }}>Next: match columns</button>}
        {step === 'map' && (
          <>
            <button type="button" className={quiet} disabled={busy} onClick={() => setStep('pick')}>Back</button>
            <button type="button" className={primary} disabled={busy} onClick={check}>{busy ? 'Checking…' : 'Check list'}</button>
          </>
        )}
        {step === 'review' && (
          <>
            <button type="button" className={quiet} disabled={busy} onClick={() => setStep('map')}>Back</button>
            <button type="button" className={primary} disabled={busy || !result.leads.length} onClick={save}>
              {busy ? 'Saving…' : `Save list (${result.summary.ready} to dial)`}
            </button>
          </>
        )}
      </Bar>
    </section>
  )
}
