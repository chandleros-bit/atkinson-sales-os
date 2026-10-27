// One lead at a glance (the contact card): book and stage, phone and email,
// the board's health pills and stage step, the Priority Leads score, Quick
// Actions and the CRM link, then tabs: Notes (the lead form's first note and
// every note, useContactNotes), Activity (calls, texts, emails, appointments),
// Loan (Bayway: lead form scenario and docs) and Details (source, owner,
// dates, tags, open tasks; useContactCard). Opens from search, the Workbench,
// and any contact name in the app (openPerson / PersonLink).
// Spec: docs/superpowers/specs/2026-10-19-tier1-pipeline-flow-design.md (5)
import { Fragment, useCallback, useEffect, useState } from 'react'
import { useContactNotes } from '../lib/contactNotes'
import { useContactCard } from '../lib/useContactCard'
import { cardTabs, detailRows, loanView, priorityLine } from '../lib/contactCard'
import { TYPE_META, groupByDay, timeOfDay } from '../lib/activity'
import HealthPills, { Pill } from './HealthPills'
import StageProgress from './StageProgress'
import { noteFacts } from '../lib/noteFacts'
import { formatPhone, telHref } from '../lib/phone'
import { dueLabel } from '../lib/tasks'
import { supabase } from '../lib/supabase'
import { usePriorityQueue } from '../lib/usePriorityQueue'
import { cardHealth } from '../lib/cardHealth'
import { CRM_LABEL } from '../lib/crmActions'
import QuickActions, { Sheet, quickActionTone } from './QuickActions'

const BOOK = { bay: 'Bayway', mpg: 'MPG' }

// One card for the whole app: any contact name calls openPerson(id) and the
// host mounted in Layout shows the sheet.
const listeners = new Set()
export function openPerson(id) {
  if (id) listeners.forEach((fn) => fn(id))
}
export function PersonSheetHost() {
  const [id, setId] = useState(null)
  useEffect(() => {
    listeners.add(setId)
    return () => listeners.delete(setId)
  }, [])
  return id ? <PersonSheet key={id} id={id} onClose={() => setId(null)} /> : null
}

const when = (iso) => {
  const d = new Date(iso)
  const day = dueLabel(iso)
  return `${day} · ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
}

function Notes({ notes, crm }) {
  const { facts, snippet } = noteFacts(notes.firstNote)
  return (
    <div aria-label="Notes">
      {notes.refreshing && <div className="mb-2 text-[11.5px] text-dim">Checking {crm}…</div>}
      {notes.firstNote && (
        <div className="mb-2 rounded-[10px] bg-panel2 px-3 py-2" data-first-note>
          <div className="mb-1 text-[11px] font-semibold text-dim">Lead form</div>
          {facts.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {facts.map((f) => (
                <span key={f.k} className="rounded-md border border-line px-1.5 py-0.5 text-[12px]">
                  <span className="text-muted">{f.k}</span> {f.v}
                </span>
              ))}
            </div>
          ) : (
            <div className="whitespace-pre-line text-[12.5px]">{snippet}</div>
          )}
        </div>
      )}
      {!notes.loading && notes.notes.length === 0 && !notes.refreshing && (
        <div className="text-[12.5px] text-muted">No notes yet. Add one with Add note above.</div>
      )}
      <ol className="flex flex-col gap-2">
        {notes.notes.map((n) => (
          <li key={n.id} data-note className="rounded-[10px] border border-line px-3 py-2">
            <div className="mb-0.5 flex flex-wrap items-baseline justify-between gap-x-2 text-[11.5px] text-dim">
              <span className="font-semibold">{n.author || crm}</span>
              <span className="num">{when(n.at)}</span>
            </div>
            {n.title && <div className="text-[12.5px] font-semibold">{n.title}</div>}
            <div className="whitespace-pre-line break-words text-[13px]">{n.text}</div>
          </li>
        ))}
      </ol>
      {notes.more && (
        <button type="button" onClick={notes.showMore} className="mt-2 min-h-[36px] w-full rounded-[10px] border border-line2 text-[12.5px] font-semibold text-muted">
          Show older notes
        </button>
      )}
      {notes.refreshError && (
        <div className="mt-2 text-[11.5px] text-dim">
          Couldn't read every note from {crm} ({notes.refreshError}). Showing what the dashboard has.
        </div>
      )}
    </div>
  )
}
// Calls, texts, emails and appointments, newest first, by day.
function ActivityTab({ rows, loading }) {
  if (loading) return <div className="text-[12.5px] text-muted">Loading…</div>
  if (!rows.length) return <div className="text-[12.5px] text-muted">No calls, texts, emails or appointments logged yet.</div>
  return (
    <div className="flex flex-col gap-3" aria-label="Activity">
      {groupByDay(rows).map((g) => (
        <div key={g.dayKey}>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-dim">{g.label}</div>
          <ol className="flex flex-col gap-1.5">
            {g.rows.map((r) => {
              const m = TYPE_META[r.type] || { label: r.type, color: 'var(--muted)', border: 'var(--line)' }
              return (
                <li key={r.id} data-card-activity={r.type} className="flex gap-2.5 rounded-[10px] border border-line px-3 py-2">
                  <span className="h-fit flex-none rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase" style={{ color: m.color, border: `1px solid ${m.border}` }}>
                    {m.label}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="num text-[11.5px] text-dim">
                      {timeOfDay(r.occurred_at)}
                      {r.direction ? ` · ${r.direction}` : ''}
                    </div>
                    {r.notes && <div className="line-clamp-3 whitespace-pre-line break-words text-[12.5px]">{r.notes}</div>}
                  </div>
                </li>
              )
            })}
          </ol>
        </div>
      ))}
    </div>
  )
}

// The lead form's scenario and the borrower docs (Bayway).
function LoanTab({ loan }) {
  return (
    <div className="flex flex-col gap-3" aria-label="Loan">
      <div>
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-dim">Lead form</div>
        {loan.facts.length > 0 ? (
          <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-1 text-[13px]">
            {loan.facts.map((f) => (
              <Fragment key={f.k}>
                <dt className="text-muted">{f.k}</dt>
                <dd data-loan-fact className="font-semibold">{f.v}</dd>
              </Fragment>
            ))}
          </dl>
        ) : (
          <div className="whitespace-pre-line text-[12.5px] text-muted">{loan.snippet || 'No lead form on file.'}</div>
        )}
      </div>
      <div>
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-dim">Docs</div>
        {!loan.docs ? (
          <div className="text-[12.5px] text-muted">Docs not tracked for this lead.</div>
        ) : loan.docs.missing.length === 0 ? (
          <div className="text-[12.5px] font-semibold" style={{ color: 'var(--pos-ink)' }}>✓ All docs received</div>
        ) : (
          <>
            <div className="mb-1.5 flex flex-wrap gap-1">
              {loan.docs.missing.map((d) => (
                <Pill key={d} tone={loan.docs.aging ? 'warn' : 'neutral'} data-missing-doc>
                  {d}
                </Pill>
              ))}
            </div>
            <div className="text-[12px] text-muted">
              {loan.docs.missing.length} missing{loan.docs.oldestDays != null ? ` · oldest requested ${loan.docs.oldestDays}d ago` : ''}
            </div>
            {loan.docs.notes && <div className="mt-1 text-[12px] italic text-muted">“{loan.docs.notes}”</div>}
          </>
        )}
      </div>
    </div>
  )
}

function DetailsTab({ rows, tasks }) {
  return (
    <div className="flex flex-col gap-3" aria-label="Details">
      <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-1.5 text-[13px]">
        {rows.map((r) => (
          <Fragment key={r.k}>
            <dt className="text-muted">{r.k}</dt>
            <dd data-detail={r.k} className="min-w-0 break-words">{r.v}</dd>
          </Fragment>
        ))}
      </dl>
      <div>
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-dim">Open tasks</div>
        {tasks.length === 0 ? (
          <div className="text-[12.5px] text-muted">No open tasks.</div>
        ) : (
          <ul className="flex flex-col gap-1">
            {tasks.map((t) => (
              <li key={t.id} className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="min-w-0 break-words">{t.title}</span>
                <span className="num flex-none text-[11.5px] text-dim">{t.due_at ? dueLabel(t.due_at) : 'No date'}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

const HEALTH = ', stage_since, crm_created_at, last_outbound_call_at, open_task_count, oldest_open_due_at'
const DOCS = ', docs_tracked, docs_outstanding, docs_oldest_requested_at, doc_notes'
// The board row carries the health fields (0034) and, for Bayway, the docs.
const BOARD = {
  bay: { view: 'v_active_pipeline', columns: 'id, stage' + HEALTH + DOCS },
  mpg: { view: 'v_mpg_contacts', columns: 'id, stage' + HEALTH },
}

// initial: the v_people row when search already has it; otherwise it loads.
export default function PersonSheet({ id, initial = null, onClose }) {
  const [person, setPerson] = useState(initial)
  const [board, setBoard] = useState(null)
  const [missing, setMissing] = useState(false)
  const { rules } = usePriorityQueue()
  const notes = useContactNotes(id)
  const extra = useContactCard(person ? id : null, person?.business_id)
  const [tab, setTab] = useState('notes')

  const load = useCallback(async () => {
    let p = initial
    if (!p) {
      const { data } = await supabase.from('v_people').select('*').eq('id', id).maybeSingle()
      if (!data) {
        setMissing(true)
        return
      }
      p = data
      setPerson(data)
    }
    const cfg = BOARD[p.business_id]
    if (!cfg || !p.on_board) {
      setBoard(null)
      return
    }
    const { data } = await supabase.from(cfg.view).select(cfg.columns).eq('id', id).maybeSingle()
    setBoard(data || null)
  }, [id, initial])

  useEffect(() => {
    load()
  }, [load])

  const biz = person?.business_id || 'bay'
  const t = quickActionTone(biz)
  const h = board && rules ? cardHealth(board, rules) : null
  const priority = priorityLine(extra.priority)
  const tabs = cardTabs(biz)

  const title = person?.name || (missing ? 'Lead not found' : 'Loading…')
  const subtitle = person ? `${BOOK[biz] || biz} · ${person.stage || '—'}${person.on_board ? '' : ' · not on the board'}` : ''

  return (
    <Sheet title={title} subtitle={subtitle} t={t} onClose={onClose}>
      {person && (
        <div className="flex flex-col gap-2 text-[13px]">
          {person.company && biz === 'mpg' && <div className="font-semibold">{person.company}</div>}
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted">
            {person.phone ? <a href={telHref(person.phone)} className="font-semibold" style={{ color: 'var(--text)' }}>{formatPhone(person.phone)}</a> : <span>No phone</span>}
            {person.email && <a href={`mailto:${person.email}`}>{person.email}</a>}
          </div>
          {(h || (biz === 'bay' && person.on_board)) && (
            <div className="flex flex-wrap items-center gap-2">
              {biz === 'bay' && person.on_board && <StageProgress stage={person.stage} />}
              <HealthPills h={h} />
            </div>
          )}
          {priority && (
            <div data-priority className="rounded-[10px] bg-panel2 px-3 py-2 text-[12.5px]">
              <span className="font-semibold">
                Priority score {priority.score}
                {priority.tier ? ` · ${priority.tier}` : ''}
              </span>
              {priority.note && <div className="mt-0.5 text-muted">{priority.note}</div>}
            </div>
          )}
          <QuickActions
            className="-ml-2"
            businessId={biz}
            contactId={person.id}
            contactName={person.name}
            hasPhone={!!person.phone}
            stage={biz === 'bay' && person.on_board ? person.stage : null}
            openTaskCount={board?.open_task_count}
            onDone={() => {
              load()
              notes.reload()
              extra.reload()
            }}
          />
          {person.crm_profile_url && (
            <a href={person.crm_profile_url} target="_blank" rel="noreferrer" className="text-[12.5px] font-semibold" style={{ color: t.ink }}>
              Open in {CRM_LABEL[biz]} ↗
            </a>
          )}
          <div role="tablist" aria-label="Contact card" className="mt-2 flex gap-1 border-b border-line">
            {tabs.map((x) => (
              <button
                key={x.id}
                type="button"
                role="tab"
                aria-selected={tab === x.id}
                onClick={() => setTab(x.id)}
                className={`-mb-px min-h-[40px] border-b-2 px-3 text-[13px] ${
                  tab === x.id ? 'border-[color:var(--text)] font-semibold' : 'border-transparent text-muted hover:text-[color:var(--text)]'
                }`}
              >
                {x.label}
                {x.id === 'notes' && notes.notes.length > 0 ? <span className="num ml-1 text-dim">{notes.notes.length}{notes.more ? '+' : ''}</span> : null}
              </button>
            ))}
          </div>
          <div role="tabpanel" className="pt-1">
            {tab === 'notes' && <Notes notes={notes} crm={CRM_LABEL[biz]} />}
            {tab === 'activity' && <ActivityTab rows={extra.activity} loading={extra.loading} />}
            {tab === 'loan' && <LoanTab loan={loanView({ firstNote: notes.firstNote, board })} />}
            {tab === 'details' && <DetailsTab rows={detailRows({ person, signal: extra.signal, contact: extra.contact })} tasks={extra.tasks} />}
          </div>
        </div>
      )}
    </Sheet>
  )
}
