// The Workbench Work lane: groups of file work (workbench.js). Each item's
// name opens the person sheet; Update (status, waiting on, check back, notes: the
// app's own work_items row, plus a Tasks tab with the lead's open tasks and
// Add a follow-up) and a finishing button:
//   estimate     Done -> "Estimate sent" / "Application sent" (FUB stage tag)
//   mpg_task     Done -> completes the Zoho task
//   application  Mark reviewed -> hidden for 3 days, or until its missing docs
//                change or the lead re-enters the stage. Update > Review
//                complete sends the outcome to FUB: Pre-Approved or Disclosed
//                (moves to that stage; off review for good),
//                Nurture or Credit Repair (parked),
//                Trash (Lost)
//   custom       Done
// A CRM Done is also recorded in work_items, for the Work progress bar.
import { useEffect, useState } from 'react'
import { supabase, isDemoMode } from '../lib/supabase'
import { useBorrowerDocs } from '../lib/useBorrowerDocs'
import { docRows } from '../lib/docChecklist'
import { TAG, REVIEW_STEPS, reviewDone, reminderLinks, fileChips, doneChoices } from '../lib/fileSheet'
import { invokeCrmAction, useWritebackFlags } from '../lib/writeback'
import { buildActionRequest, followUpDate, summarizeResult, LOST_REASONS, LOST_WARNING } from '../lib/crmActions'
import { saveWorkItem, loadChecklist, saveChecklist, WAITING_ON } from '../lib/workItems'
import BizBadge from './BizBadge'
import { Pill } from './HealthPills'
import { useContactTasks } from '../lib/useContactTasks'
import ContactTasks, { PopupTabs, taskCount } from './ContactTasks'
import PersonSheet from './PersonSheet'
import { Sheet, quickActionTone } from './QuickActions'
import { showToast } from './Toaster'
import { useAuth } from '../context/AuthContext'
import { PERSON_LINK_CLS } from './PersonLink'

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
  { key: 'pre_approved', label: 'Pre-Approved', done: (n) => `${n} moved to Pre-Approved in FollowUpBoss` },
  { key: 'disclosed', label: 'Disclosed', done: (n) => `${n} moved to Disclosed in FollowUpBoss` },
  { key: 'nurture', label: 'Nurture', done: (n) => `${n} tagged Nurture in FollowUpBoss` },
  { key: 'credit_repair', label: 'Credit Repair', done: (n) => `${n} tagged Credit Repair in FollowUpBoss` },
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
    <span className="rounded-full border border-line2 px-2 py-[1px] text-micro font-semibold text-muted">
      {status === 'working' ? 'Working' : 'Waiting'}
    </span>
  )
}

// The open-file sheet (Workbench v2 spec §11): one Files item with everything
// to work it. canReview: write-back to FUB is on (stage outcomes write there).
// info: { loan, value } from Workbench (value hidden for the assistant).
// onFinish(choice, reason, notes, next): runs a "When done" choice; the lane
// records it done, and with next opens the next file.
function FileSheet({ item, info, canReview, assistant, onFinish, onClose, onSaved, hasNext }) {
  const [status, setStatus] = useState(item.status === 'waiting' || item.status === 'working' ? item.status : 'open')
  const [choice, setChoice] = useState(null)
  const [reason, setReason] = useState(null)
  const [who, setWho] = useState(item.waitingOn || '')
  const [back, setBack] = useState(item.checkBackOn ? 'pick' : 'tomorrow')
  const [picked, setPicked] = useState(item.checkBackOn || '')
  const [notes, setNotes] = useState(item.notes || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('update')
  const tasks = useContactTasks(item.contactId)
  const bay = item.book === 'bay' && !!item.contactId
  const docs = useBorrowerDocs(bay ? item.contactId : null)
  const needed = docRows(docs.docs || []).filter((d) => d.status === 'needed')
  const person = usePersonContact(item.contactId)
  const links = reminderLinks({ name: item.name, phone: person?.phone, email: person?.email, docs: needed.map((d) => d.name) })
  const [checks, setChecks] = useState({})
  useEffect(() => {
    if (item.kind !== 'application') return
    let live = true
    loadChecklist(item).then((c) => live && setChecks(c || {}))
    return () => {
      live = false
    }
  }, [item])
  const toggleStep = async (key) => {
    const next = { ...checks, [key]: !checks[key] }
    setChecks(next)
    const { error: err } = await saveChecklist(item, next)
    if (err) setError(`Couldn't save the step: ${err.message}`)
  }

  const choices = [
    ...doneChoices(item),
    ...(item.kind === 'application' ? OUTCOMES.filter((o) => !['pre_approved', 'disclosed'].includes(o.key)).map((o) => ({ key: o.key, label: o.label, action: 'stage', target: o.key, explain: o.done(item.name) + '.' })) : []),
  ]
  const picked_ = choices.find((c) => c.key === choice)
  const needsCrm = picked_ && (picked_.action === 'stage' || picked_.action === 'complete')

  const finish = (next) => {
    if (!picked_) return setError('Pick what happened under When done.')
    if (picked_.target === 'lost' && !reason) return setError('Pick why it goes to the trash.')
    if (needsCrm && !canReview) return setError(assistant ? 'Chandler sends this to the CRM.' : "Write-back is off, so this can't be sent.")
    setError(null)
    onFinish(picked_, reason, notes.trim() || null, next)
  }

  const save = async () => {
    if (busy) return
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

  const chips = fileChips(item, info?.loan)
  const value = !assistant ? info?.value : null
  return (
    <Sheet title={[item.name, item.title].filter(Boolean).join(' · ') || 'Work item'} subtitle={[TAG[item.kind] || 'Task', 'Files', item.book === 'mpg' ? 'MPG' : 'Bayway', item.minutes && `~${item.minutes} min`].filter(Boolean).join(' · ')} t={quickActionTone(item.book)} onClose={onClose}>
      <div data-file-sheet={item.key} className="-mt-2 mb-3 flex flex-col gap-2">
        {value && (
          <div className="text-body text-muted">
            {value.exact ? 'Est. commission' : 'Est. value'} <b className="num text-ui text-[color:var(--text)]">{value.text}</b>
          </div>
        )}
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5 text-caption">
            {chips.map((c) => (
              <span key={c} className="rounded-md bg-panel2 px-2 py-1">
                {c}
              </span>
            ))}
          </div>
        )}
        {person?.crm_profile_url && (
          <a href={person.crm_profile_url} target="_blank" rel="noreferrer" className="text-body font-semibold text-[color:var(--chrome)]">
            Open in {item.book === 'mpg' ? 'Zoho' : 'FUB'}
          </a>
        )}
      </div>
      {item.contactId && (
        <div className="mb-3">
          <PopupTabs
            label="Work item"
            tabs={[
              ['update', 'File', null],
              ['tasks', 'Tasks', taskCount(tasks)],
            ]}
            tab={tab}
            onTab={setTab}
          />
        </div>
      )}
      {tab === 'tasks' && <ContactTasks businessId={item.book} contactId={item.contactId} contactName={item.name} tasks={tasks} />}
      <div className={`flex flex-col gap-4 ${tab === 'update' ? '' : 'hidden'}`}>
        <div>
          <div className="mb-1.5 text-caption font-semibold text-muted">Status</div>
          <div className="grid grid-cols-3 gap-2">
            {STATUS.map(([k, label]) => (
              <button key={k} type="button" aria-pressed={status === k} onClick={() => setStatus(k)} className="min-h-[40px] rounded-lg border text-body font-semibold" style={chip(status === k)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {status === 'waiting' && (
          <>
            <div>
              <div className="mb-1.5 text-caption font-semibold text-muted">Waiting on</div>
              <div className="flex flex-wrap gap-2">
                {WAITING_ON.map((w) => (
                  <button key={w} type="button" aria-pressed={who === w} onClick={() => setWho(w)} className="min-h-[36px] rounded-lg border px-3 text-body font-semibold" style={chip(who === w)}>
                    {w}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-caption font-semibold text-muted">Check back</div>
              <div className="flex flex-wrap gap-2">
                {BACK.map(([k, label]) => (
                  <button key={k} type="button" aria-pressed={back === k} onClick={() => setBack(k)} className="min-h-[36px] rounded-lg border px-3 text-body font-semibold" style={chip(back === k)}>
                    {label}
                  </button>
                ))}
              </div>
              {back === 'pick' && (
                <input type="date" aria-label="Check back on" value={picked} onChange={(e) => setPicked(e.target.value)} className="mt-2 w-full rounded-lg border border-line2 bg-panel px-3 py-2 text-body" />
              )}
            </div>
          </>
        )}

        {bay && needed.length > 0 && (
          <section aria-label="Missing documents" data-missing-docs className="overflow-hidden rounded-lg border" style={{ borderColor: 'var(--warn-line)' }}>
            <div className="flex flex-wrap items-center gap-2 px-3 py-2" style={{ background: 'var(--warn-bg)' }}>
              <span className="text-body font-bold">Missing documents · {needed.length}</span>
              <span className="flex-1 text-caption" style={{ color: 'var(--warn-ink)' }}>
                {needed[0].days != null ? `oldest asked for ${needed[0].days} days ago` : ''}
              </span>
              {links.sms && (
                <a href={links.sms} className="rounded-lg px-2.5 py-1.5 text-caption font-semibold text-white" style={{ background: 'var(--warn-ink)' }}>
                  Text a reminder for all {needed.length}
                </a>
              )}
              {links.email && (
                <a href={links.email} className="rounded-lg border px-2.5 py-1.5 text-caption font-semibold" style={{ borderColor: 'var(--warn-line)', color: 'var(--warn-ink)' }}>
                  Email it
                </a>
              )}
            </div>
            {needed.map((d) => (
              <div key={d.id} className="flex gap-2 border-t px-3 py-1.5 text-body" style={{ borderColor: 'var(--warn-line)' }}>
                <span className="flex-1">{d.name}</span>
                <span className="text-caption" style={{ color: d.chase ? 'var(--warn-ink)' : 'var(--muted)' }}>{d.label}</span>
              </div>
            ))}
          </section>
        )}

        {item.kind === 'application' && (
          <section aria-label="Review steps" data-review-steps>
            <div className="mb-1.5 text-caption font-semibold text-muted">
              Review · {reviewDone(checks)} of {REVIEW_STEPS.length}
            </div>
            {REVIEW_STEPS.map((s) => (
              <label key={s.key} className="flex min-h-[34px] items-center gap-2.5 text-body">
                <input type="checkbox" checked={!!checks[s.key]} onChange={() => toggleStep(s.key)} className="h-4 w-4" />
                <span className={checks[s.key] ? 'text-muted line-through' : ''}>{s.label}</span>
              </label>
            ))}
          </section>
        )}

        <textarea
          aria-label="Work notes"
          placeholder="Notes: what's done, what's next"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full rounded-lg border border-line2 bg-panel px-3 py-2 text-body"
        />
        <div className="text-caption text-muted">Notes and status stay in the dashboard, not in {item.book === 'mpg' ? 'Zoho' : 'FollowUpBoss'}.</div>

        <section aria-label="When done" className="flex flex-col gap-2 border-t border-line pt-3">
          <div className="text-caption font-semibold text-muted">When done</div>
          <div className="flex flex-wrap gap-2">
            {choices.map((c) => (
              <button key={c.key} type="button" aria-pressed={choice === c.key} onClick={() => setChoice(c.key)} className="min-h-[38px] rounded-lg border px-3 text-body font-semibold" style={chip(choice === c.key)}>
                {c.label}
              </button>
            ))}
          </div>
          {picked_ && <p className="rounded-lg bg-panel2 px-3 py-2 text-body text-muted">{picked_.explain}</p>}
          {picked_?.target === 'lost' && (
            <div>
              <div className="mb-1.5 text-caption font-semibold text-muted">Why?</div>
              <div className="flex flex-wrap gap-2">
                {LOST_REASONS.map((r) => (
                  <button key={r} type="button" aria-pressed={reason === r} onClick={() => setReason(r)} className="min-h-[36px] rounded-lg border px-3 text-body font-semibold" style={chip(reason === r)}>
                    {r}
                  </button>
                ))}
              </div>
              <div className="mt-2 text-caption text-muted">{LOST_WARNING}</div>
            </div>
          )}
        </section>

        {error && <div className="text-caption text-[color:var(--neg-ink)]">{error}</div>}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={save} className="min-h-[44px] flex-1 rounded-lg border border-line2 px-3 text-body font-semibold disabled:opacity-50">
            Save
          </button>
          <button type="button" disabled={!choice} onClick={() => finish(false)} className="min-h-[44px] flex-1 rounded-lg border border-line2 px-3 text-body font-semibold disabled:opacity-50">
            Done
          </button>
          {hasNext && (
            <button type="button" disabled={!choice} onClick={() => finish(true)} className="min-h-[44px] flex-1 rounded-lg px-3 text-body font-semibold text-white disabled:opacity-50" style={{ background: 'var(--text)' }}>
              Done and next file
            </button>
          )}
        </div>
      </div>
    </Sheet>
  )
}

// The person's phone, email and CRM link, for the reminder links and Open in FUB.
function usePersonContact(id) {
  const [p, setP] = useState(null)
  useEffect(() => {
    setP(null)
    if (!id || isDemoMode) return
    let live = true
    Promise.resolve(supabase.from('v_people').select('id, phone, email, crm_profile_url').eq('id', id).maybeSingle())
      .then((res) => live && setP(res?.data || null))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [id])
  return p
}

// Two lines: what (title, status, rough time); who (the name opens the person
// sheet), why and the latest note. Update and the finishing button sit beside.
function WorkItemRow({ it, showBook, canDone, busy, onOpen, onUpdate, onFinish }) {
  const finish = it.kind === 'application' ? 'Mark reviewed' : canDone ? 'Done' : null
  const note = it.notes?.split('\n')[0]
  return (
    <div data-work-item={it.key} className="flex items-center gap-3 border-b border-line px-4 py-2 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2 leading-5">
          {showBook && <BizBadge biz={it.book} />}
          <span className="min-w-0 truncate text-ui font-semibold">{it.title}</span>
          <StatusPill status={it.status} />
          {it.minutes && (
            <span className="num flex-none rounded-full bg-panel2 px-2 py-[1px] text-micro font-semibold text-muted" title="Rough time">
              ~{it.minutes}m
            </span>
          )}
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-body leading-[18px] text-muted">
          {it.name &&
            (it.contactId ? (
              <button type="button" onClick={onOpen} title="Open contact card" className={`min-w-0 truncate font-semibold text-[color:var(--text)] ${PERSON_LINK_CLS}`}>
                {it.name}
              </button>
            ) : (
              <span className="min-w-0 truncate">{it.name}</span>
            ))}
          {it.why && (
            <Pill tone={it.late ? 'neg' : 'neutral'} className="flex-none text-caption" data-health={it.late ? 'late' : 'ok'}>
              {it.why}
            </Pill>
          )}
          {note && <span className="min-w-0 truncate italic">“{note}”</span>}
        </div>
      </div>
      <div className="flex flex-none gap-1.5">
        <button type="button" onClick={onUpdate} className="min-h-[32px] rounded-lg border border-line2 px-2.5 text-body font-semibold text-ink2">
          Open
        </button>
        {finish && (
          <button
            type="button"
            disabled={busy}
            onClick={onFinish}
            className="min-h-[32px] rounded-lg px-2.5 text-body font-semibold text-white disabled:opacity-50"
            style={{ background: 'var(--chrome)' }}
          >
            {finish}
          </button>
        )}
      </div>
    </div>
  )
}

// A group's title: larger and darker than the rows so each category reads as
// its own section inside the lane.
function GroupTitle({ g, count, children }) {
  return (
    <div className="flex items-center gap-2 border-b border-line px-4 pb-1.5 pt-4">
      {g.book && <BizBadge biz={g.book} />}
      <h3 className="text-ui font-bold tracking-[-0.1px] text-[color:var(--text)]">{g.title}</h3>
      <span className="num rounded-full bg-hoverbg px-2 py-[1px] text-caption font-semibold text-muted">{count}</span>
      {children}
    </div>
  )
}

// info(item) -> { loan, value } (Workbench). openKey / onOpenKey: Workbench can
// open a file (Next up, Start first file); order: the Files items in the day's
// order, for Done and next file.
export default function WorkLane({ groups, onChanged, info = null, openKey = null, onOpenKey = null, order = null }) {
  const flags = useWritebackFlags()
  // The assistant login can't move stages (estimate sent, review outcomes).
  const { role } = useAuth() || {}
  const assistant = role === 'assistant'
  const [personId, setPersonId] = useState(null)
  const [picking, setPicking] = useState(null)
  const [localOpen, setLocalOpen] = useState(null)
  const openKeyNow = onOpenKey ? openKey : localOpen
  const setOpen = (key) => (onOpenKey ? onOpenKey(key) : setLocalOpen(key))
  const allItems = groups.flatMap((g) => g.items)
  const updating = openKeyNow ? allItems.find((it) => it.key === openKeyNow) || null : null
  const setUpdating = (it) => setOpen(it ? it.key : null)
  const fileOrder = order || groups.filter((g) => g.id !== 'waiting').flatMap((g) => g.items)
  const nextAfter = (key) => {
    const i = fileOrder.findIndex((it) => it.key === key)
    return fileOrder[i + 1] || null
  }
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
      canDone={it.kind === 'custom' || it.kind === 'disclosed' || ((it.kind === 'estimate' || it.kind === 'mpg_task') && flags[it.book] === true && !assistant)}
      busy={busy === it.key}
      onOpen={() => setPersonId(it.contactId)}
      onUpdate={() => setUpdating(it)}
      onFinish={() => finish(it)}
    />
  )

  return (
    <div className="flex flex-col pb-2">
      {groups.map((g) => {
        if (g.id === 'waiting') {
          if (g.items.length === 0) return null
          return (
            <section key={g.id}>
              <button
                type="button"
                aria-expanded={showWaiting}
                onClick={() => setShowWaiting((v) => !v)}
                className="flex w-full items-center justify-between border-b border-dashed border-line2 px-4 pb-1.5 pt-4 text-left text-ui font-bold"
              >
                <span>{`${g.title} · ${g.items.length}`}</span>
                <span aria-hidden="true" className="text-muted">{showWaiting ? '▴' : '▾'}</span>
              </button>
              {showWaiting && <div>{g.items.map((it) => row(g, it))}</div>}
            </section>
          )
        }
        return (
          <section key={g.id}>
            <GroupTitle g={g} count={g.items.length} />
            {g.items.length === 0 && (
              <div className="px-4 py-2.5 text-body text-muted">{g.id === 'custom' ? 'Add your own with + Work item.' : 'Nothing here right now.'}</div>
            )}
            {g.items.map((it) => row(g, it))}
          </section>
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
                    className={`min-h-[44px] rounded-lg border text-body font-semibold ${suggested ? 'border-transparent text-white' : 'border-line2'}`}
                    style={suggested ? { background: 'var(--text)' } : undefined}
                  >
                    {s.label}
                  </button>
                )
              })}
            <div id="sent-suggested" className="text-caption text-muted">
              {picking.suggestedSent === 'estimate_sent' ? 'Suggested: DSCR lead, usually comparing lenders.' : 'Suggested: buyer who needs a pre-approval.'}
            </div>
          </div>
        </Sheet>
      )}
      {updating && (
        <FileSheet
          key={updating.key}
          item={updating}
          info={info ? info(updating) : null}
          assistant={assistant}
          canReview={flags[updating.book] === true && !assistant}
          hasNext={!!nextAfter(updating.key)}
          onFinish={async (choice, reason, notes, next) => {
            const item = updating
            const following = next ? nextAfter(item.key) : null
            setUpdating(null)
            const extra = notes ? { notes } : undefined
            if (choice.action === 'stage') {
              const label = choice.target === 'estimate_sent' || choice.target === 'application_sent' ? `${item.name} moved to ${choice.label} in FollowUpBoss` : OUTCOMES.find((o) => o.key === choice.target)?.done(item.name)
              await run(item, buildActionRequest({ action: 'set_stage', contactId: item.contactId, target: choice.target, reason }), label, extra)
            } else if (choice.action === 'complete') {
              await run(item, buildActionRequest({ action: 'complete_task', taskId: item.taskId }), null, extra)
            } else {
              setBusy(item.key)
              await record(item, choice.action === 'reviewed' ? `${item.name} reviewed. Back in 3 days, or sooner if docs change.` : `Done: ${item.title}`, extra)
              setBusy(null)
              onChanged?.()
            }
            if (following) setUpdating(following)
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
