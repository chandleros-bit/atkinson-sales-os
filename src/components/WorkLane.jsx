// The Workbench Work lane: groups of file work (workbench.js). Each item has
// Open (person sheet), Update (status, waiting on, check back, notes: the
// app's own work_items row) and a finishing button:
//   estimate     Done -> "Estimate sent" / "Application sent" (FUB stage tag)
//   mpg_task     Done -> completes the Zoho task
//   application  Mark reviewed -> hidden for 3 days, or until its missing docs
//                change or the lead re-enters the stage. Update > Review
//                complete sends the outcome to FUB: Pre-Approved or Disclosed
//                (tag; off review for good), Credit Repair (Nurture), Trash (Lost)
//   custom       Done
// A CRM Done is also recorded in work_items, for the Work progress bar.
import { useState } from 'react'
import { invokeCrmAction, useWritebackFlags } from '../lib/writeback'
import { buildActionRequest, followUpDate, summarizeResult, LOST_REASONS, LOST_WARNING } from '../lib/crmActions'
import { saveWorkItem, WAITING_ON } from '../lib/workItems'
import BizBadge from './BizBadge'
import { Pill } from './HealthPills'
import PersonSheet from './PersonSheet'
import { Sheet, quickActionTone } from './QuickActions'
import { showToast } from './Toaster'

const SENT = [
  { key: 'estimate_sent', label: 'Estimate sent' },
  { key: 'application_sent', label: 'Application sent' },
]
const STATUS = [
  ['open', 'Open'],
  ['working', 'Working'],
  ['waiting', 'Waiting on…'],
]
// Review complete outcomes (applications): crm-action set_stage targets.
const OUTCOMES = [
  { key: 'pre_approved', label: 'Pre-Approved', done: (n) => `${n} tagged Pre-Approved in FollowUpBoss` },
  { key: 'disclosed', label: 'Disclosed', done: (n) => `${n} tagged Disclosed in FollowUpBoss` },
  { key: 'credit_repair', label: 'Credit Repair', done: (n) => `${n} moved to Nurture / Credit Repair in FollowUpBoss` },
  { key: 'lost', label: 'Trash', done: (n) => `${n} marked Lost in FollowUpBoss` },
]
const BACK = [
  ['tomorrow', 'Tomorrow'],
  ['nextMonday', 'Next Monday'],
  ['pick', 'Pick a date'],
]

const chip = (on) =>
  on ? { borderColor: 'var(--text)', color: 'var(--text)' } : { borderColor: 'var(--line2)', color: 'var(--muted)' }

function StatusPill({ status }) {
  if (status !== 'working' && status !== 'waiting') return null
  return (
    <span className="rounded-full border border-line2 px-2 py-[1px] text-[11px] font-semibold text-muted">
      {status === 'working' ? 'Working' : 'Waiting'}
    </span>
  )
}

// canReview: write-back to FUB is on (Review complete writes there).
// onReview(outcome, reason, notes): runs the CRM step; the lane records done.
function UpdateSheet({ item, canReview, onReview, onClose, onSaved }) {
  const [status, setStatus] = useState(item.status === 'waiting' || item.status === 'working' ? item.status : 'open')
  const [outcome, setOutcome] = useState(null)
  const [reason, setReason] = useState(null)
  const reviewable = item.kind === 'application'
  const statuses = reviewable ? [...STATUS, ['review', 'Review complete']] : STATUS
  const [who, setWho] = useState(item.waitingOn || '')
  const [back, setBack] = useState(item.checkBackOn ? 'pick' : 'tomorrow')
  const [picked, setPicked] = useState(item.checkBackOn || '')
  const [notes, setNotes] = useState(item.notes || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const save = async () => {
    if (busy) return
    if (status === 'review') {
      if (!outcome) return setError('Pick the review outcome.')
      if (outcome === 'lost' && !reason) return setError('Pick why it goes to the trash.')
      setError(null)
      onReview(OUTCOMES.find((o) => o.key === outcome), reason, notes.trim() || null)
      return
    }
    let patch = { status, notes: notes.trim() || null }
    if (status === 'waiting') {
      let day
      try {
        day = followUpDate(back, new Date(), picked)
      } catch (e) {
        setError(e.message.replace('follow-up', 'check-back day'))
        return
      }
      patch = { ...patch, waiting_on: who || null, check_back_on: day }
    }
    setBusy(true)
    setError(null)
    const { error: err } = await saveWorkItem(item, patch)
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    showToast({ tone: 'ok', text: status === 'waiting' ? `${item.name || item.title} parked as waiting` : 'Saved' })
    onSaved()
  }

  return (
    <Sheet title="Update work item" subtitle={[item.title, item.name].filter(Boolean).join(' · ')} t={quickActionTone(item.book)} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div className={`grid gap-2 ${reviewable ? 'grid-cols-2' : 'grid-cols-3'}`}>
          {statuses.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={status === k} onClick={() => setStatus(k)} className="min-h-[40px] rounded-[10px] border text-[12.5px] font-semibold" style={chip(status === k)}>
              {label}
            </button>
          ))}
        </div>
        {status === 'waiting' && (
          <>
            <div>
              <div className="mb-1.5 text-[12px] font-semibold text-muted">Waiting on</div>
              <div className="flex flex-wrap gap-2">
                {WAITING_ON.map((w) => (
                  <button key={w} type="button" aria-pressed={who === w} onClick={() => setWho(w)} className="min-h-[36px] rounded-[10px] border px-3 text-[12.5px] font-semibold" style={chip(who === w)}>
                    {w}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-[12px] font-semibold text-muted">Check back</div>
              <div className="flex flex-wrap gap-2">
                {BACK.map(([k, label]) => (
                  <button key={k} type="button" aria-pressed={back === k} onClick={() => setBack(k)} className="min-h-[36px] rounded-[10px] border px-3 text-[12.5px] font-semibold" style={chip(back === k)}>
                    {label}
                  </button>
                ))}
              </div>
              {back === 'pick' && (
                <input
                  type="date"
                  aria-label="Check back on"
                  value={picked}
                  onChange={(e) => setPicked(e.target.value)}
                  className="mt-2 w-full rounded-[10px] border border-line2 bg-panel px-3 py-2 text-[13px]"
                />
              )}
            </div>
          </>
        )}
        {status === 'review' && (
          <div>
            <div className="mb-1.5 text-[12px] font-semibold text-muted">Outcome</div>
            <div className="grid grid-cols-2 gap-2">
              {OUTCOMES.map((o) => (
                <button key={o.key} type="button" aria-pressed={outcome === o.key} onClick={() => setOutcome(o.key)} className="min-h-[40px] rounded-[10px] border text-[12.5px] font-semibold" style={chip(outcome === o.key)}>
                  {o.label}
                </button>
              ))}
            </div>
            {outcome === 'lost' && (
              <div className="mt-3">
                <div className="mb-1.5 text-[12px] font-semibold text-muted">Why?</div>
                <div className="flex flex-wrap gap-2">
                  {LOST_REASONS.map((r) => (
                    <button key={r} type="button" aria-pressed={reason === r} onClick={() => setReason(r)} className="min-h-[36px] rounded-[10px] border px-3 text-[12.5px] font-semibold" style={chip(reason === r)}>
                      {r}
                    </button>
                  ))}
                </div>
                <div className="mt-2 text-[12px] text-muted">{LOST_WARNING}</div>
              </div>
            )}
            {!canReview && <div className="mt-2 text-[12px] text-[color:var(--neg-ink)]">Write-back to FollowUpBoss is off, so the outcome can't be sent.</div>}
          </div>
        )}
        <textarea
          aria-label="Work notes"
          placeholder="Notes: what's done, what's next"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full rounded-[10px] border border-line2 bg-panel px-3 py-2 text-[13px]"
        />
        <div className="text-[11.5px] text-muted">
          {status === 'review' ? 'The outcome goes to FollowUpBoss; notes stay in the dashboard.' : `Saved in the dashboard only, not in ${item.book === 'mpg' ? 'Zoho' : 'FollowUpBoss'}.`}
        </div>
        {error && <div className="text-[12px] text-[color:var(--neg-ink)]">{error}</div>}
        <button
          type="button"
          disabled={busy || (status === 'review' && !canReview)}
          onClick={save}
          className="min-h-[44px] rounded-[10px] text-[13.5px] font-semibold text-white disabled:opacity-50"
          style={{ background: 'var(--text)' }}
        >
          Save
        </button>
      </div>
    </Sheet>
  )
}

function WorkItemRow({ it, showBook, canDone, busy, onOpen, onUpdate, onFinish }) {
  const finish = it.kind === 'application' ? 'Mark reviewed' : canDone ? 'Done' : null
  const note = it.notes?.split('\n')[0]
  return (
    <div data-work-item className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-3 last:border-b-0">
      <div className="min-w-0 flex-[1_1_220px]">
        <div className="flex items-center gap-2">
          {showBook && <BizBadge biz={it.book} />}
          <span className="text-[14px] font-semibold">{it.title}</span>
          <StatusPill status={it.status} />
          {it.minutes && (
            <span className="num rounded-full bg-panel2 px-2 py-[1px] text-[11px] font-semibold text-muted" title="Rough time">
              ~{it.minutes}m
            </span>
          )}
        </div>
        {it.name && <div className="truncate text-[12.5px] text-muted">{it.name}</div>}
        {it.why && (
          <Pill tone={it.late ? 'neg' : 'neutral'} className="mt-1 text-[12px]" data-health={it.late ? 'late' : 'ok'}>
            {it.why}
          </Pill>
        )}
        {note && <div className="truncate text-[12.5px] italic text-muted">“{note}”</div>}
      </div>
      <div className="flex flex-none gap-1.5">
        {it.contactId && (
          <button type="button" onClick={onOpen} className="min-h-[40px] rounded-[10px] border border-line2 px-3 text-[13px] font-semibold">
            Open
          </button>
        )}
        <button type="button" onClick={onUpdate} className="min-h-[40px] rounded-[10px] border border-line2 px-3 text-[13px] font-semibold">
          Update
        </button>
        {finish && (
          <button
            type="button"
            disabled={busy}
            onClick={onFinish}
            className="min-h-[40px] rounded-[10px] px-3 text-[13px] font-semibold text-white disabled:opacity-50"
            style={{ background: 'var(--text)' }}
          >
            {finish}
          </button>
        )}
      </div>
    </div>
  )
}

export default function WorkLane({ groups, onChanged }) {
  const flags = useWritebackFlags()
  const [personId, setPersonId] = useState(null)
  const [picking, setPicking] = useState(null)
  const [updating, setUpdating] = useState(null)
  const [busy, setBusy] = useState(null)
  const [showWaiting, setShowWaiting] = useState(false)

  const record = async (item, okText, extra) => {
    const { error } = await saveWorkItem(item, { ...extra, status: 'done' })
    if (error) showToast({ tone: 'error', text: `Couldn't save in the dashboard: ${error.message}` })
    else if (okText) showToast({ tone: 'ok', text: okText })
  }

  const run = async (item, request, okText, extra) => {
    setBusy(item.key)
    const res = await invokeCrmAction(request)
    const summary = summarizeResult(res, item.book)
    showToast(summary.tone === 'ok' && okText ? { ...summary, text: okText } : summary)
    if (summary.tone === 'ok') await record(item, null, extra)
    setBusy(null)
    if (summary.tone !== 'error') onChanged?.()
  }

  const finish = async (item) => {
    if (item.kind === 'estimate') setPicking(item)
    else if (item.kind === 'mpg_task') run(item, buildActionRequest({ action: 'complete_task', taskId: item.taskId }))
    else {
      setBusy(item.key)
      await record(item, item.kind === 'application' ? `${item.name} reviewed. Back in 3 days, or sooner if docs change.` : `Done: ${item.title}`)
      setBusy(null)
      onChanged?.()
    }
  }

  const sent = (target) => {
    const item = picking
    setPicking(null)
    run(item, buildActionRequest({ action: 'set_stage', contactId: item.contactId, target: target.key }), `${item.name} moved to ${target.label} in FollowUpBoss`)
  }

  const row = (g, it) => (
    <WorkItemRow
      key={it.key}
      it={it}
      showBook={g.book == null}
      canDone={it.kind === 'custom' || ((it.kind === 'estimate' || it.kind === 'mpg_task') && flags[it.book] === true)}
      busy={busy === it.key}
      onOpen={() => setPersonId(it.contactId)}
      onUpdate={() => setUpdating(it)}
      onFinish={() => finish(it)}
    />
  )

  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => {
        if (g.id === 'waiting') {
          if (g.items.length === 0) return null
          return (
            <div key={g.id} className="overflow-hidden rounded-card border border-dashed border-line2 bg-panel">
              <button
                type="button"
                aria-expanded={showWaiting}
                onClick={() => setShowWaiting((v) => !v)}
                className="flex w-full items-center justify-between px-4 py-3 text-left text-[14px] font-bold"
              >
                <span>{`${g.title} · ${g.items.length}`}</span>
                <span aria-hidden="true" className="text-muted">{showWaiting ? '▴' : '▾'}</span>
              </button>
              {showWaiting && <div className="border-t border-line">{g.items.map((it) => row(g, it))}</div>}
            </div>
          )
        }
        return (
          <div key={g.id} className="overflow-hidden rounded-card border border-line bg-panel">
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              {g.book && <BizBadge biz={g.book} />}
              <h2 className="text-[15px] font-bold">{g.title}</h2>
              <span className="num text-[12.5px] font-semibold text-muted">{g.items.length}</span>
            </div>
            {g.items.length === 0 && (
              <div className="px-4 py-3 text-[13px] text-muted">{g.id === 'custom' ? 'Add your own with + Work item.' : 'Nothing here right now.'}</div>
            )}
            {g.items.map((it) => row(g, it))}
          </div>
        )
      })}
      {picking && (
        <Sheet title="What did you send?" subtitle={`${picking.name} · moves the lead in FollowUpBoss`} t={quickActionTone('bay')} onClose={() => setPicking(null)}>
          {/* The suggested one (DSCR -> Estimate sent, else Application sent) comes first, filled. */}
          <div className="flex flex-col gap-2">
            {[...SENT]
              .sort((a, b) => (b.key === picking.suggestedSent) - (a.key === picking.suggestedSent))
              .map((s) => {
                const suggested = s.key === picking.suggestedSent
                return (
                  <button
                    key={s.key}
                    type="button"
                    aria-describedby={suggested ? 'sent-suggested' : undefined}
                    onClick={() => sent(s)}
                    className={`min-h-[44px] rounded-[10px] border text-[13.5px] font-semibold ${suggested ? 'border-transparent text-white' : 'border-line2'}`}
                    style={suggested ? { background: 'var(--text)' } : undefined}
                  >
                    {s.label}
                  </button>
                )
              })}
            <div id="sent-suggested" className="text-[12px] text-muted">
              {picking.suggestedSent === 'estimate_sent' ? 'Suggested: DSCR lead, usually comparing lenders.' : 'Suggested: buyer who needs a pre-approval.'}
            </div>
          </div>
        </Sheet>
      )}
      {updating && (
        <UpdateSheet
          item={updating}
          canReview={flags.bay === true}
          onReview={(outcome, reason, notes) => {
            const item = updating
            setUpdating(null)
            run(
              item,
              buildActionRequest({ action: 'set_stage', contactId: item.contactId, target: outcome.key, reason }),
              outcome.done(item.name),
              notes ? { notes } : undefined,
            )
          }}
          onClose={() => setUpdating(null)}
          onSaved={() => {
            setUpdating(null)
            onChanged?.()
          }}
        />
      )}
      {personId && <PersonSheet id={personId} onClose={() => setPersonId(null)} />}
    </div>
  )
}
