// Drafts inbox (Bayway Bot Engine doc, Sales OS item 2). Every bot draft waits
// here for Approve, Edit or Skip. Review once a day after 11 AM, in one batch.
// Decided shows the last 30 days so outcomes can be filled in for the tune-up.
import { useCallback, useEffect, useState } from 'react'
import PageHeader from '../components/PageHeader'
import PersonLink from '../components/PersonLink'
import { showToast } from '../components/Toaster'
import { isDemoMode } from '../lib/supabase'
import { friendlyError } from '../lib/friendlyError'
import {
  REASONS, OUTCOMES, TYPE_LABEL, botLabel,
  loadDrafts, approveDraft, skipDraft, setOutcome,
} from '../lib/drafts'

const BTN = 'min-h-[36px] rounded-lg border border-line2 px-3 font-medium hover:bg-hoverbg disabled:opacity-50'
const FIELD = 'w-full rounded-lg border border-line2 bg-transparent px-3 py-2 text-body'

function DraftCard({ d, onDone }) {
  const [subject, setSubject] = useState(d.subject || '')
  const [body, setBody] = useState(d.body || '')
  const [skipping, setSkipping] = useState(false)
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const edited = subject !== (d.original_subject || '') || body !== d.original_body

  const approve = async () => {
    setBusy(true)
    try {
      const res = await approveDraft(d, { subject, body })
      if (!res.ok) throw new Error(res.error)
      if (res.url) window.location.href = res.url
      onDone(d.id, res.patch)
    } catch (e) {
      showToast({ tone: 'error', text: friendlyError(e) })
      setBusy(false)
    }
  }
  const skip = async () => {
    setBusy(true)
    try {
      onDone(d.id, await skipDraft(d, reason || null, note))
    } catch (e) {
      showToast({ tone: 'error', text: friendlyError(e) })
      setBusy(false)
    }
  }

  return (
    <article data-draft={d.id} className="cc-card flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2 text-body">
        <span className="font-semibold">{botLabel(d.bot)}</span>
        <span className="text-muted">· {TYPE_LABEL[d.draft_type] || d.draft_type}</span>
        {(d.to_name || d.to_email) && (
          <span className="text-muted">
            · to{' '}
            {d.contact_id ? <PersonLink id={d.contact_id}>{d.to_name || d.to_email}</PersonLink> : d.to_name || d.to_email}
          </span>
        )}
        {edited && <span data-edited className="rounded-full border border-line2 px-2 text-xs text-muted">Edited</span>}
      </div>
      {d.draft_type !== 'gbp_post' && (
        <input aria-label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className={FIELD} />
      )}
      <textarea aria-label="Body" value={body} onChange={(e) => setBody(e.target.value)} rows={Math.min(14, Math.max(5, body.split('\n').length + 1))} className={FIELD} />
      {!skipping ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" data-approve onClick={approve} disabled={busy || !body.trim()} className={`${BTN} font-semibold`}>
            {d.draft_type === 'email' ? 'Approve and open in Outlook' : 'Approve'}
          </button>
          <button type="button" data-skip onClick={() => setSkipping(true)} disabled={busy} className={BTN}>Skip</button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-body">
          <select aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} className="rounded-lg border border-line2 bg-transparent px-2 py-1">
            <option value="">Reason (optional)</option>
            {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <input aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="One line (optional)" className="min-w-[180px] flex-1 rounded-lg border border-line2 bg-transparent px-2 py-1" />
          <button type="button" data-skip-confirm onClick={skip} disabled={busy} className={BTN}>Skip draft</button>
          <button type="button" onClick={() => setSkipping(false)} className="px-2 text-muted">Cancel</button>
        </div>
      )}
    </article>
  )
}

function DecidedRow({ d, onSaved }) {
  const save = async (value) => {
    try {
      onSaved(d.id, await setOutcome(d, value))
    } catch (e) {
      showToast({ tone: 'error', text: friendlyError(e) })
    }
  }
  return (
    <tr data-decided={d.id} className="border-t border-line align-top">
      <td className="py-1.5 pr-3">{botLabel(d.bot)}</td>
      <td className="pr-3">{d.to_name || d.to_email || ''}</td>
      <td className="pr-3">{d.final_subject || d.subject || TYPE_LABEL[d.draft_type]}</td>
      <td className="pr-3">
        {d.status === 'skipped' ? `Skipped${d.reason ? `: ${d.reason}` : ''}` : d.change_pct ? `Approved, ${d.change_pct}% edited` : 'Approved as written'}
      </td>
      <td>
        {d.status !== 'skipped' && (
          <select aria-label="Outcome" value={d.outcome || ''} onChange={(e) => save(e.target.value)} className="rounded-lg border border-line2 bg-transparent px-2 py-1">
            <option value="">No outcome yet</option>
            {OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        )}
      </td>
    </tr>
  )
}

export default function Drafts() {
  const [tab, setTab] = useState('waiting')
  const [rows, setRows] = useState(null)

  const reload = useCallback(async (which) => {
    setRows(null)
    try {
      setRows(await loadDrafts({ status: which }))
    } catch (e) {
      setRows([])
      showToast({ tone: 'error', text: friendlyError(e) })
    }
  }, [])
  useEffect(() => { reload(tab) }, [tab, reload])

  const decided = (id) => setRows((rs) => rs.filter((r) => r.id !== id))
  const patched = (id, patch) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)))

  return (
    <div className="flex flex-col gap-4 pt-4">
      <PageHeader eyebrow="Bayway" title="Drafts" subtitle="Bot drafts waiting for you. Review once a day, after your 9 to 11 calls." />
      <div role="tablist" className="flex gap-2">
        {[['waiting', 'Waiting'], ['decided', 'Decided']].map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`min-h-[32px] rounded-full border px-3 text-body ${tab === k ? 'border-[color:var(--text)] font-semibold' : 'border-line2 text-muted hover:bg-hoverbg'}`}>
            {label}
          </button>
        ))}
      </div>
      {isDemoMode && <p className="text-body text-muted">Connect Supabase to see drafts.</p>}
      {!isDemoMode && rows === null && <p className="text-body text-muted">Loading…</p>}
      {!isDemoMode && rows && tab === 'waiting' && (
        rows.length ? (
          <div className="flex flex-col gap-4">{rows.map((d) => <DraftCard key={d.id} d={d} onDone={decided} />)}</div>
        ) : (
          <p className="text-body text-muted">Nothing waiting. Bots drop drafts here as they run.</p>
        )
      )}
      {!isDemoMode && rows && tab === 'decided' && (
        rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-body">
              <thead><tr className="text-left text-xs text-dim"><th className="py-1 pr-3">Bot</th><th className="pr-3">To</th><th className="pr-3">Subject</th><th className="pr-3">Decision</th><th>Outcome</th></tr></thead>
              <tbody>{rows.map((d) => <DecidedRow key={d.id} d={d} onSaved={patched} />)}</tbody>
            </table>
          </div>
        ) : (
          <p className="text-body text-muted">No decisions in the last 30 days.</p>
        )
      )}
    </div>
  )
}
