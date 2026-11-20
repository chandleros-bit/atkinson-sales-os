// Power Dialer Ready to Push (spec 2026-11-20, "Ready to Push queue"). Every
// confirmed lead waits here; nothing reaches Zoho or FUB until it is approved.
// Each row shows the exact fields that will be written (the same builders the
// dialer-crm-push function uses), which can be edited first. Approve one or
// several, Skip (keeps the lead in Sales OS only), Retry a failed row.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import BizBadge from '../components/BizBadge'
import { useBusiness } from '../context/BusinessContext'
import { fetchQueue, saveQueueEdits, skipQueueRows, approveQueueRows } from '../lib/dialerData'
import { outcome as outcomeOf } from '../lib/dialerQueue'
import { FIELD_KEYS, pushFields, buildZohoDialerLead, buildFubDialerPerson } from '../../supabase/functions/_shared/dialer-push.ts'

const LABEL = { first_name: 'First name', last_name: 'Last name', company: 'Company', phone: 'Phone', email: 'Email', address: 'Address', city: 'City', state: 'State', zip: 'Zip' }
const quiet = 'min-h-[40px] rounded-lg border border-line2 px-3 text-body font-semibold text-ink2 disabled:opacity-40'
const primary = 'min-h-[40px] rounded-lg bg-[color:var(--text)] px-3 text-body font-semibold text-white disabled:opacity-40'

// What will be written, as label: value lines, or the reason it can't be.
function preview(row) {
  const lead = row.dialer_leads
  const fields = pushFields(lead, row.payload?.fields || {})
  try {
    if (row.business_id === 'mpg') {
      const z = buildZohoDialerLead(fields, { listName: lead.dialer_lists?.name || '' }).data[0]
      return { lines: Object.entries(z).map(([k, v]) => [k, Array.isArray(v) ? v.map((x) => x.name).join(', ') : String(v)]) }
    }
    const p = buildFubDialerPerson(fields, { outcome: row.outcome, temperature: lead.dialer_lists?.temperature })
    return {
      lines: [
        ['Name', [p.firstName, p.lastName].filter(Boolean).join(' ')],
        ['Phone', p.phones[0].value],
        ...(p.emails ? [['Email', p.emails[0].value]] : []),
        ...(p.addresses ? [['Address', Object.values(p.addresses[0]).filter(Boolean).join(', ')]] : []),
        ['Source', p.source],
        ['Tags', p.tags.join(', ')],
      ],
    }
  } catch (e) {
    return { lines: [], problem: e.message }
  }
}

const matchText = (m) => {
  if (!m) return 'Not found in the CRM at upload. Checked again before writing.'
  const where = m.crm === 'zoho' ? `Zoho ${m.module}` : 'FUB'
  return `Already in ${where}${m.name ? `: ${m.name}` : ''}${m.owner ? `, owner ${m.owner}` : ''}. The note is added there, no new record.`
}

function Row({ row, picked, onPick, onChanged, busy, onApprove, onSkip }) {
  const lead = row.dialer_leads
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(null)
  const [error, setError] = useState(null)
  const fields = pushFields(lead, row.payload?.fields || {})
  const p = preview(row)
  const calls = (lead.dialer_calls || []).filter((c) => c.outcome).sort((a, b) => Date.parse(a.dialed_at) - Date.parse(b.dialed_at))
  const last = calls[calls.length - 1]
  const who = [fields.first_name, fields.last_name].filter(Boolean).join(' ') || fields.company || fields.phone

  async function save() {
    const edits = {}
    for (const k of FIELD_KEYS) if ((draft[k] || null) !== (pushFields(lead)[k] || null)) edits[k] = draft[k]
    const { error: err } = await saveQueueEdits(row.id, edits)
    if (err) { setError(err.message); return }
    setEditing(false)
    onChanged({ ...row, payload: { fields: edits } })
  }

  return (
    <li data-row-id={row.id} className="flex flex-col gap-2 rounded-card border border-line bg-panel p-3">
      <div className="flex flex-wrap items-center gap-2">
        <input type="checkbox" aria-label={`Select ${who}`} checked={picked} onChange={(e) => onPick(e.target.checked)} disabled={!!p.problem} />
        <span className="min-w-0 flex-1 truncate text-ui font-semibold">{who}</span>
        <BizBadge biz={row.business_id} />
        <span className="rounded-md border border-line2 px-1.5 text-micro font-bold text-ink2">{outcomeOf(row.outcome)?.label}</span>
      </div>
      {last?.notes && <p className="text-body text-ink2">“{last.notes}”</p>}
      <p data-match className="text-body text-muted">{matchText(lead.crm_match)}</p>
      {row.status === 'failed' && (
        <div role="alert" data-failed className="rounded-lg border border-neg-line bg-neg-bg px-3 py-2 text-body text-neg-ink">Push failed: {row.error}</div>
      )}

      {editing ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {FIELD_KEYS.map((k) => (
            <label key={k} className="block text-body">
              <span className="text-muted">{LABEL[k]}</span>
              <input aria-label={LABEL[k]} value={draft[k] || ''} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
                className="mt-0.5 block min-h-[40px] w-full rounded-lg border border-line2 bg-panel px-2" />
            </label>
          ))}
        </div>
      ) : (
        <div className="rounded-lg bg-panel2 px-3 py-2">
          <div className="text-micro font-semibold uppercase tracking-[.4px] text-dim">
            {row.business_id === 'mpg' ? 'Zoho Lead fields' : 'FUB person fields'} that will be written
          </div>
          {p.problem ? (
            <p className="text-body text-neg-ink">{p.problem}. Edit the fields first.</p>
          ) : (
            <dl data-preview className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-body">
              {p.lines.map(([k, v]) => (
                <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="min-w-0 break-words">{v}</dd></div>
              ))}
            </dl>
          )}
          <p className="mt-1 text-caption text-muted">Plus a note with the call history ({calls.length} {calls.length === 1 ? 'call' : 'calls'}).</p>
        </div>
      )}
      {error && <div role="alert" className="text-body text-neg-ink">{error}</div>}

      <div className="flex flex-wrap gap-2">
        {editing ? (
          <>
            <button type="button" className={quiet} onClick={() => setEditing(false)}>Cancel</button>
            <button type="button" className={primary} onClick={save}>Save fields</button>
          </>
        ) : (
          <>
            <button type="button" className={quiet} disabled={busy} onClick={() => { setDraft(fields); setEditing(true) }}>Edit</button>
            <button type="button" className={quiet} disabled={busy} onClick={onSkip}>Skip</button>
            <button type="button" className={primary} disabled={busy || !!p.problem} onClick={onApprove}>
              {row.status === 'failed' ? 'Retry' : 'Approve'}
            </button>
          </>
        )}
      </div>
    </li>
  )
}

export default function PushQueue() {
  const { biz } = useBusiness()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [picked, setPicked] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null) // summary of the last approve

  const load = useCallback(async () => {
    const { data, error: err } = await fetchQueue()
    if (err) setError(err.message || String(err))
    else { setError(null); setRows(data) }
  }, [])
  useEffect(() => { load() }, [load])

  const shown = useMemo(() => (rows || []).filter((r) => biz === 'all' || r.business_id === biz), [rows, biz])
  const pickable = shown.filter((r) => !preview(r).problem)

  async function approve(ids) {
    setBusy(true)
    setDone(null)
    const { results, error: err } = await approveQueueRows(ids)
    setBusy(false)
    if (err) { setError(`Couldn't reach the push function: ${err.message}`); return }
    const by = Object.fromEntries(results.map((r) => [r.id, r]))
    const pushed = results.filter((r) => r.status === 'pushed').length
    const failed = results.filter((r) => r.status === 'failed').length
    setDone({ pushed, failed })
    setPicked(new Set())
    // Pushed rows leave the queue; failed ones stay with their error.
    setRows((rs) => rs.filter((r) => by[r.id]?.status !== 'pushed').map((r) => (by[r.id]?.status === 'failed' ? { ...r, status: 'failed', error: by[r.id].error } : r)))
  }

  async function skip(ids) {
    const { error: err } = await skipQueueRows(ids)
    if (err) { setError(err.message); return }
    setRows((rs) => rs.filter((r) => !ids.includes(r.id)))
    setPicked((s) => { const n = new Set(s); ids.forEach((i) => n.delete(i)); return n })
  }

  return (
    <div className="flex flex-col gap-4 pt-4">
      <Link to="/dialer" className="text-body font-semibold text-muted">‹ Power Dialer</Link>
      <PageHeader title="Ready to Push" subtitle="Confirmed leads wait here. Nothing is written to Zoho or FUB until you approve it." />

      {error && <div role="alert" className="rounded-lg border border-neg-line bg-neg-bg px-3 py-2 text-body text-neg-ink">{error}</div>}
      {done && (
        <div role="status" data-done className="rounded-lg border border-line bg-panel px-3 py-2 text-body">
          {done.pushed} pushed{done.failed ? `, ${done.failed} failed (see below)` : ''}.
        </div>
      )}

      {rows && !shown.length && (
        <div className="rounded-card border border-line bg-panel px-6 py-10 text-center text-sm text-muted">Nothing waiting. Confirmed leads from the dialer show up here.</div>
      )}

      {shown.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-body">
              <input type="checkbox" aria-label="Select all"
                checked={pickable.length > 0 && pickable.every((r) => picked.has(r.id))}
                onChange={(e) => setPicked(e.target.checked ? new Set(pickable.map((r) => r.id)) : new Set())} />
              Select all
            </label>
            <span className="flex-1" />
            <button type="button" className={quiet} disabled={!picked.size || busy} onClick={() => skip([...picked])}>Skip selected</button>
            <button type="button" className={primary} disabled={!picked.size || busy} onClick={() => approve([...picked])}>
              {busy ? 'Pushing…' : `Approve selected (${picked.size})`}
            </button>
          </div>
          <ul aria-label="Ready to Push" className="flex flex-col gap-3">
            {shown.map((r) => (
              <Row key={r.id} row={r} busy={busy} picked={picked.has(r.id)}
                onPick={(on) => setPicked((s) => { const n = new Set(s); if (on) n.add(r.id); else n.delete(r.id); return n })}
                onChanged={(next) => setRows((rs) => rs.map((x) => (x.id === next.id ? next : x)))}
                onApprove={() => approve([r.id])}
                onSkip={() => skip([r.id])} />
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
