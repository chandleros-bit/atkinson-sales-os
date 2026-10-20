// One lead at a glance, from search: book and stage, phone and email, the
// board's health line, the last note, Quick Actions and the CRM link. The seed
// of the Tier 2 lead panel.
// Spec: docs/superpowers/specs/2026-10-19-tier1-pipeline-flow-design.md (5)
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { usePriorityQueue } from '../lib/usePriorityQueue'
import { cardHealth } from '../lib/cardHealth'
import { CRM_LABEL } from '../lib/crmActions'
import QuickActions, { Sheet, quickActionTone } from './QuickActions'

const BOOK = { bay: 'Bayway', mpg: 'MPG' }
const HEALTH = ', stage_since, crm_created_at, last_outbound_call_at, open_task_count, oldest_open_due_at'
// The board row carries the health fields (0034) and, for Bayway, the last note.
const BOARD = {
  bay: { view: 'v_active_pipeline', columns: 'id, stage, last_note_snippet' + HEALTH },
  mpg: { view: 'v_mpg_contacts', columns: 'id, stage' + HEALTH },
}

// initial: the v_people row when search already has it; otherwise it loads.
export default function PersonSheet({ id, initial = null, onClose }) {
  const [person, setPerson] = useState(initial)
  const [board, setBoard] = useState(null)
  const [missing, setMissing] = useState(false)
  const { rules } = usePriorityQueue()

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
            {person.phone ? <a href={`tel:${person.phone}`}>{person.phone}</a> : <span>No phone</span>}
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
          {board?.last_note_snippet && (
            <div className="truncate text-[12.5px] text-muted">“{board.last_note_snippet}”</div>
          )}
          <QuickActions
            className="-ml-2"
            businessId={biz}
            contactId={person.id}
            contactName={person.name}
            hasPhone={!!person.phone}
            stage={biz === 'bay' && person.on_board ? person.stage : null}
            openTaskCount={board?.open_task_count}
            onDone={load}
          />
          {person.crm_profile_url && (
            <a href={person.crm_profile_url} target="_blank" rel="noreferrer" className="text-[12.5px] font-semibold" style={{ color: t.ink }}>
              Open in {CRM_LABEL[biz]} ↗
            </a>
          )}
        </div>
      )}
    </Sheet>
  )
}
