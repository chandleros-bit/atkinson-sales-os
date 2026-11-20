// Power Dialer settings (spec 2026-11-20, "Settings"): per business the call
// script, follow-up text and email templates, the retry rule and (Bayway) the
// Cold-list calling hours guard; and the shared Do Not Call list.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import Segmented from '../components/Segmented'
import { useBusiness } from '../context/BusinessContext'
import { fetchScripts, saveScript, fetchDnc, addDnc, removeDnc } from '../lib/dialerData'
import { normalizePhone } from '../lib/dialerImport'
import { formatPhone } from '../lib/phone'

const input = 'mt-1 block w-full rounded-lg border border-line2 bg-panel px-3 py-2 text-body'
const primary = 'min-h-[40px] rounded-lg bg-[color:var(--text)] px-4 text-body font-semibold text-white disabled:opacity-40'
const quiet = 'min-h-[36px] rounded-lg border border-line2 px-3 text-body font-semibold text-ink2 disabled:opacity-40'
const BLANK = { body: '', sms_template: '', email_subject: '', email_body: '', max_attempts: 3, min_retry_hours: 4, hours_guard: true }
const FIELDS = ['body', 'sms_template', 'email_subject', 'email_body', 'max_attempts', 'min_retry_hours', 'hours_guard']

function Card({ title, children }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3 rounded-card border border-line bg-panel p-4">
      <h2 className="text-ui font-semibold">{title}</h2>
      {children}
    </section>
  )
}

function ScriptSettings({ business, row, onSaved }) {
  const [draft, setDraft] = useState(() => ({ ...BLANK, ...row }))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const set = (k) => (e) => setDraft({ ...draft, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const attempts = Number(draft.max_attempts)
  const hours = Number(draft.min_retry_hours)
  const bad = !(attempts >= 1 && attempts <= 3) ? 'Max attempts is 1 to 3 (Florida allows 3 calls in 24 hours).'
    : !(hours >= 1 && hours <= 72) ? 'Hours between attempts is 1 to 72.' : null

  async function save() {
    setBusy(true)
    setMsg(null)
    const fields = Object.fromEntries(FIELDS.map((k) => [k, draft[k]]))
    fields.max_attempts = attempts
    fields.min_retry_hours = hours
    const { error } = await saveScript(business, fields)
    setBusy(false)
    if (error) { setMsg({ error: error.message }); return }
    setMsg({ ok: 'Saved.' })
    onSaved({ ...row, ...fields, business_id: business })
  }

  return (
    <>
      <Card title="Call script">
        <label className="block text-body">
          <span className="text-muted">Shown in the Script drawer. Lines starting with # are headings, - are bullets.</span>
          <textarea aria-label="Call script" rows={8} value={draft.body} onChange={set('body')} className={input} />
        </label>
      </Card>
      <Card title="Follow-up templates">
        <p className="text-body text-muted">Use {'{first_name}'}, {'{last_name}'}, {'{name}'} and {'{company}'}. A blank one drops its comma.</p>
        <label className="block text-body">Text message
          <textarea aria-label="Text template" rows={3} value={draft.sms_template} onChange={set('sms_template')} className={input} />
        </label>
        <label className="block text-body">Email subject
          <input aria-label="Email subject" value={draft.email_subject} onChange={set('email_subject')} className={input} />
        </label>
        <label className="block text-body">Email body
          <textarea aria-label="Email body" rows={5} value={draft.email_body} onChange={set('email_body')} className={input} />
        </label>
      </Card>
      <Card title="Retries and calling hours">
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-body">Max attempts
            <input aria-label="Max attempts" type="number" min={1} max={3} value={draft.max_attempts} onChange={set('max_attempts')} className={input} />
          </label>
          <label className="block text-body">Hours between attempts
            <input aria-label="Hours between attempts" type="number" min={1} max={72} value={draft.min_retry_hours} onChange={set('min_retry_hours')} className={input} />
          </label>
        </div>
        {business === 'bay' && (
          <label className="flex items-start gap-2 text-body">
            <input type="checkbox" aria-label="Calling hours guard" checked={!!draft.hours_guard} onChange={set('hours_guard')} className="mt-1" />
            <span>Calling hours guard on Cold lists: Mon-Sat 9 AM-8 PM, Sun noon-8 PM in the lead's local time. Keep this on unless Bayway's compliance contact says otherwise.</span>
          </label>
        )}
      </Card>
      {bad && <div role="alert" className="text-body text-neg-ink">{bad}</div>}
      {msg?.error && <div role="alert" className="text-body text-neg-ink">{msg.error}</div>}
      {msg?.ok && <div role="status" data-saved className="text-body text-muted">{msg.ok}</div>}
      <div><button type="button" className={primary} disabled={busy || !!bad} onClick={save}>{busy ? 'Saving…' : 'Save settings'}</button></div>
    </>
  )
}

function DncManager() {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState([])
  const [phone, setPhone] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState(null)

  useEffect(() => {
    let live = true
    const t = setTimeout(async () => {
      const { data, error: err } = await fetchDnc(q)
      if (!live) return
      if (err) setError(err.message)
      else { setError(null); setRows(data || []) }
    }, 250)
    return () => { live = false; clearTimeout(t) }
  }, [q])

  async function add() {
    const e164 = normalizePhone(phone)
    if (!e164) { setError('That is not a valid phone number.'); return }
    const { error: err } = await addDnc(e164, reason.trim())
    if (err) { setError(err.message); return }
    setError(null)
    setRows((rs) => [{ phone_e164: e164, reason: reason.trim() || null, source: 'manual', added_at: new Date().toISOString() }, ...rs.filter((r) => r.phone_e164 !== e164)])
    setPhone('')
    setReason('')
  }

  async function remove(e164) {
    const { error: err } = await removeDnc(e164)
    if (err) { setError(err.message); return }
    setRows((rs) => rs.filter((r) => r.phone_e164 !== e164))
  }

  return (
    <Card title="Do Not Call list">
      <p className="text-body text-muted">Shared by MPG and Bayway. Every upload leaves these numbers out of dialing. Removing a number does not reopen leads already marked Do Not Call.</p>
      <div className="flex flex-wrap gap-2">
        <input aria-label="Number to block" placeholder="Phone number" value={phone} onChange={(e) => setPhone(e.target.value)} className={`${input} mt-0 min-w-[150px] flex-1`} />
        <input aria-label="Reason" placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} className={`${input} mt-0 min-w-[150px] flex-1`} />
        <button type="button" className={primary} disabled={!phone.trim()} onClick={add}>Add</button>
      </div>
      <input aria-label="Search the list" placeholder="Search by number" value={q} onChange={(e) => setQ(e.target.value)} className={input} />
      {error && <div role="alert" className="text-body text-neg-ink">{error}</div>}
      <ul aria-label="Blocked numbers" className="flex flex-col divide-y divide-line">
        {rows.map((r) => (
          <li key={r.phone_e164} data-dnc={r.phone_e164} className="flex items-center gap-3 py-2 text-body">
            <span className="num font-semibold">{formatPhone(r.phone_e164.replace(/^\+1/, '')) || r.phone_e164}</span>
            <span className="min-w-0 flex-1 truncate text-muted">{[r.reason, r.source].filter(Boolean).join(' · ')}</span>
            <button type="button" className={quiet} onClick={() => remove(r.phone_e164)}>Remove</button>
          </li>
        ))}
        {!rows.length && <li className="py-2 text-body text-muted">No numbers{q ? ' match' : ' yet'}.</li>}
      </ul>
    </Card>
  )
}

export default function DialerSettings() {
  const { biz } = useBusiness()
  const [business, setBusiness] = useState(biz === 'bay' ? 'bay' : 'mpg')
  const [scripts, setScripts] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchScripts().then(({ data, error: err }) => (err ? setError(err.message) : setScripts(data)))
  }, [])

  return (
    <div className="flex flex-col gap-4 pt-4">
      <Link to="/dialer" className="text-body font-semibold text-muted">‹ Power Dialer</Link>
      <PageHeader title="Dialer settings" subtitle="Scripts, follow-up templates, retries, calling hours and the Do Not Call list." />
      {error && <div role="alert" className="text-body text-neg-ink">Couldn't load settings: {error}</div>}
      <Segmented label="Business" options={[['mpg', 'MPG'], ['bay', 'Bayway']]} value={business} onChange={setBusiness} />
      {scripts && (
        // key: a fresh form per business, so a save's "Saved." survives the refresh.
        <ScriptSettings key={business} business={business} row={scripts[business] || null}
          onSaved={(next) => setScripts((s) => ({ ...s, [business]: next }))} />
      )}
      <DncManager />
    </div>
  )
}
