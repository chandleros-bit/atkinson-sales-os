// One lead at a glance (the contact card): book and stage, phone and email,
// the board's health line, Quick Actions, the lead form's first note and every
// note on the lead (useContactNotes), and the CRM link. Opens from search, the
// Workbench, and any contact name in the app (openPerson / PersonLink).
// Spec: docs/superpowers/specs/2026-10-19-tier1-pipeline-flow-design.md (5)
import { useCallback, useEffect, useState } from 'react'
import { useContactNotes } from '../lib/contactNotes'
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
    <div className="mt-2 border-t border-line pt-3" aria-label="Notes">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[12px] font-bold uppercase tracking-wide text-muted">Notes</div>
        {notes.refreshing && <div className="text-[11.5px] text-dim">Checking {crm}…</div>}
      </div>
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
const HEALTH = ', stage_since, crm_created_at, last_outbound_call_at, open_task_count, oldest_open_due_at'
// The board row carries the health fields (0034) and, for Bayway, the last note.
const BOARD = {
  bay: { view: 'v_active_pipeline', columns: 'id, stage' + HEALTH },
  mpg: { view: 'v_mpg_contacts', columns: 'id, stage' + HEALTH },
}

// initial: the v_people row when search already has it; otherwise it loads.
export default function PersonSheet({ id, initial = null, onClose }) {
  const [person, setPerson] = useState(initial)
  const [board, setBoard] = useState(null)
  const [missing, setMissing] = useState(false)
  const { rules } = usePriorityQueue()
  const notes = useContactNotes(id)

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
  const health = h?.speed?.text || (h && h.next.state !== 'parked' ? h.next.text : '')
  const late = h?.speed?.late || h?.next.state === 'overdue'

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
          {health && (
            <div
              className={late ? 'font-semibold' : 'text-muted'}
              style={late ? { color: 'var(--neg-ink)' } : undefined}
              data-health={h.speed ? 'speed' : h.next.state}
            >
              {health}
            </div>
          )}
          {h?.stuck && (
            <div className="font-semibold" style={{ color: 'var(--neg-ink)' }}>
              {h.stuck.text}
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
            }}
          />
          {person.crm_profile_url && (
            <a href={person.crm_profile_url} target="_blank" rel="noreferrer" className="text-[12.5px] font-semibold" style={{ color: t.ink }}>
              Open in {CRM_LABEL[biz]} ↗
            </a>
          )}
          <Notes notes={notes} crm={CRM_LABEL[biz]} />
        </div>
      )}
    </Sheet>
  )
}
