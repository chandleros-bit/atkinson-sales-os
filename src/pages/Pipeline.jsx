import { useEffect, useState, useCallback } from 'react'
import { supabase, isDemoMode } from '../lib/supabase'
import { fetchAllSettled } from '../lib/fetchAll'
import { lastTouchLabel, daysSince, STALE_TOUCH_DAYS } from '../lib/overview'
import { buildColumns, MPG_LEAD_FLOW, dropTargetFor, withPendingMoves } from '../lib/pipeline'
import { cardHealth, sortByHealth, columnSummary } from '../lib/cardHealth'
import { usePriorityQueue } from '../lib/usePriorityQueue'
import { useNow } from '../lib/useNow'
import { useWritebackFlags, invokeCrmAction } from '../lib/writeback'
import { buildActionRequest, summarizeResult, needsNextStepPrompt, LOST_REASONS } from '../lib/crmActions'
import { docsState, docSummary, isDocAging } from '../lib/borrowerDocs'
import CrmLink from '../components/CrmLink'
import QuickActions, { NextStepPrompt } from '../components/QuickActions'
import { showToast } from '../components/Toaster'

function BizHeader({ biz, note }) {
  const isMpg = biz === 'mpg'
  return (
    <div>
      <div className="flex items-center gap-3">
        <h2 className="text-[26px] font-bold tracking-tight">Pipeline</h2>
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide"
          style={{
            color: isMpg ? 'var(--mpg)' : 'var(--bay)',
            background: isMpg ? 'var(--mpg-soft)' : 'var(--bay-soft)',
          }}
        >
          {isMpg ? 'MPG' : 'BAYWAY'}
        </span>
        {note}
      </div>
    </div>
  )
}

// Docs live on Bayway cards only — there is no Arive and no sheet for MPG.
function DocsBlock({ r }) {
  const state = docsState(r)
  if (state === 'untracked') {
    return <div className="mt-1.5 text-[11px] text-dim">Docs not tracked</div>
  }
  if (state === 'clear') {
    return (
      <div className="mt-1.5 text-[11px]" style={{ color: 'var(--bay-ink)' }}>
        ✓ All docs received
      </div>
    )
  }
  const aging = isDocAging(r.docs_oldest_requested_at)
  const days = daysSince(r.docs_oldest_requested_at)
  return (
    <div className="mt-1.5">
      <div
        className={`text-[11px] ${aging ? 'font-semibold' : 'text-muted'}`}
        style={aging ? { color: 'var(--bay-gold)' } : undefined}
      >
        {aging ? '⚠ ' : ''}
        {r.docs_outstanding_count} doc{r.docs_outstanding_count === 1 ? '' : 's'}
        {days !== null ? ` · oldest ${days}d` : ''}
      </div>
      <div className="truncate text-[11px] text-muted">{docSummary(r.docs_outstanding)}</div>
      {/* The assistant's own note from the sheet's Notes column — why a doc is
          still outstanding. Only shown here, in the outstanding state: on a
          cleared or untracked card it has nothing to explain, and the board's
          value is scanning a column in one pass. */}
      {r.doc_notes ? (
        <div className="truncate text-[11px] text-dim">{r.doc_notes}</div>
      ) : null}
    </div>
  )
}

// One line, truncated. Omitted entirely when there is no note — an empty quote
// reads as "they said nothing" rather than "we have nothing on record".
function LastNote({ r }) {
  if (!r.last_note_snippet) return null
  const d = daysSince(r.last_note_at)
  return (
    <div className="mt-1.5 truncate text-[11px] text-muted">
      💬 “{r.last_note_snippet}”
      {d !== null ? <span className="text-dim"> · {d}d</span> : null}
    </div>
  )
}

// Next-step dot + words. The colour is never the only signal.
const DOT = { overdue: 'var(--neg-ink)', today: 'var(--bay-gold)', scheduled: 'var(--pos-ink)', none: 'var(--dim)' }

function HealthLine({ h }) {
  if (!h) return null
  if (h.speed) {
    return (
      <div
        className="mt-1 flex items-center gap-1.5 text-[11px] font-semibold"
        style={{ color: h.speed.late ? 'var(--neg-ink)' : 'var(--muted)' }}
        data-health="speed"
        data-late={h.speed.late ? 'true' : 'false'}
      >
        <span aria-hidden="true">⏱</span>
        {h.speed.text}
      </div>
    )
  }
  if (h.next.state === 'parked') return null
  const overdue = h.next.state === 'overdue'
  return (
    <div className="mt-1 flex items-center gap-1.5 text-[11px]" data-health={h.next.state}>
      <span aria-hidden="true" className="h-[7px] w-[7px] flex-none rounded-full" style={{ background: DOT[h.next.state] }} />
      <span className={overdue ? 'font-semibold' : 'text-muted'} style={overdue ? { color: 'var(--neg-ink)' } : undefined}>
        {h.next.text}
      </span>
    </div>
  )
}

function StuckLine({ h }) {
  if (!h?.stuck) return null
  return (
    <div className="mt-0.5 text-[11px] font-semibold" style={{ color: 'var(--neg-ink)' }} data-health="stuck">
      {h.stuck.text}
    </div>
  )
}

function Card({ r, lost, biz, onDone, onPrompt, drag, health }) {
  const d = daysSince(r.last_touch_at)
  const stale = d === null || d >= STALE_TOUCH_DAYS
  const accent = biz === 'mpg' ? 'var(--mpg)' : 'var(--bay)'
  // MPG cards are merchant-first (the company is the deal); Bayway is person-first.
  const headline = biz === 'mpg' ? r.company || r.name : r.name
  const sub = biz === 'mpg' ? r.name || r.phone || r.email : r.phone || r.email
  return (
    <div
      className={`relative rounded-lg border border-line bg-panel2 px-3 py-2.5 pl-3.5 ${
        drag && !r.moving ? 'cursor-grab active:cursor-grabbing' : ''
      } ${r.moving ? 'opacity-60' : ''}`}
      draggable={!!drag && !r.moving}
      onDragStart={
        drag
          ? (e) => {
              // Firefox only starts a drag when data is set.
              e.dataTransfer?.setData('text/plain', r.id)
              if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
              drag.onStart(r.id)
            }
          : undefined
      }
      onDragEnd={drag ? drag.onEnd : undefined}
      data-card-id={r.id}
    >
      <span
        className="absolute bottom-2 left-0 top-2 w-[3px] rounded-sm"
        style={{ background: lost ? 'var(--dim)' : health?.stuck ? 'var(--neg-ink)' : accent }}
      />
      {r.moving && (
        <span className="absolute right-2 top-2 text-[10.5px] font-semibold text-dim">Moving…</span>
      )}
      <CrmLink url={r.crm_profile_url} className="block truncate text-[13px] font-semibold">
        {headline || '(no name)'}
      </CrmLink>
      <div className="mt-0.5 truncate text-[11.5px] text-muted">
        {sub || 'no contact info'}
      </div>
      <HealthLine h={health} />
      <StuckLine h={health} />
      <div
        className={`mt-1 text-[11px] ${stale ? 'font-semibold' : 'text-dim'}`}
        style={stale ? { color: 'var(--bay-gold)' } : undefined}
      >
        {lastTouchLabel(r.last_touch_at)}
      </div>
      {biz !== 'mpg' && !lost && (
        <>
          <DocsBlock r={r} />
          <LastNote r={r} />
        </>
      )}
      <QuickActions
        className="-mb-1.5 -ml-2 mt-1"
        businessId={biz === 'mpg' ? 'mpg' : 'bay'}
        contactId={r.id}
        contactName={r.name}
        hasPhone={!!r.phone}
        stage={biz === 'mpg' ? null : r.stage}
        openTaskCount={r.open_task_count}
        onNeedsNextStep={onPrompt ? () => onPrompt(r) : undefined}
        onDone={onDone}
      />
    </div>
  )
}

function Column({ col, biz, onDone, onPrompt, drag, rules, now }) {
  const isOver = drag?.over === col.stage
  const summary = rules ? columnSummary(col.cards, rules, now) : ''
  return (
    <div
      className="w-[280px] flex-none rounded-card border bg-panel transition-colors"
      style={{
        borderColor: isOver ? 'var(--bay)' : 'var(--line)',
        background: isOver ? 'var(--bay-soft)' : undefined,
      }}
      onDragOver={
        drag
          ? (e) => {
              if (!drag.draggingId || drag.draggingStage === col.stage) return
              e.preventDefault()
              if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
              drag.onOver(col.stage)
            }
          : undefined
      }
      onDragLeave={
        drag ? (e) => !e.currentTarget.contains(e.relatedTarget) && drag.onOver(null) : undefined
      }
      onDrop={
        drag
          ? (e) => {
              e.preventDefault()
              drag.onDrop(col.stage)
            }
          : undefined
      }
      data-stage={col.stage}
    >
      <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
        <span className={`text-[12.5px] font-semibold ${col.isLost ? 'text-dim' : ''}`}>
          {col.stage}
        </span>
        <span className="num text-[11px] text-muted" data-col-count>
          {col.cards.length}
          {summary ? ` · ${summary}` : ''}
        </span>
      </div>
      <div className="flex min-h-[64px] flex-col gap-2 p-2.5">
        {col.cards.map((r) => (
          <Card
            key={r.id}
            r={r}
            lost={col.isLost}
            biz={biz}
            onDone={onDone}
            onPrompt={onPrompt}
            drag={drag}
            health={rules ? cardHealth(r, rules, now) : null}
          />
        ))}
        {col.cards.length === 0 && (
          <div className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-[11.5px] text-dim">
            {drag ? 'Drop a lead here' : 'Empty'}
          </div>
        )}
      </div>
    </div>
  )
}

function Board({ columns, biz, onDone, onPrompt, drag, rules, now }) {
  return (
    <div className="mt-5 flex gap-3.5 overflow-x-auto pb-2">
      {columns.map((col) => (
        <Column key={col.stage} col={col} biz={biz} onDone={onDone} onPrompt={onPrompt} drag={drag} rules={rules} now={now} />
      ))}
    </div>
  )
}

// Off-flow moves while dragging, so parking a lead needs no scroll to the
// far-right column. Lost asks why first and leaves the board.
const DROP_ZONES = [
  { key: 'credit_repair', stage: 'Nurture / Credit Repair' },
  { key: 'lost', stage: 'Lost', needsReason: true },
]

function DropZones({ drag }) {
  if (!drag?.draggingId) return null
  const zones = DROP_ZONES.filter((z) => z.stage !== drag.draggingStage)
  if (zones.length === 0) return null
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 flex flex-wrap justify-center gap-3 border-t border-line bg-panel/95 px-4 py-3 backdrop-blur"
      data-drop-zones
    >
      {zones.map((z) => {
        const over = drag.over === `zone:${z.key}`
        return (
          <div
            key={z.key}
            data-zone={z.key}
            className="flex min-h-[56px] min-w-[240px] items-center justify-center rounded-card border-2 border-dashed px-4 text-[13px] font-semibold transition-colors"
            style={{
              borderColor: over ? 'var(--bay)' : 'var(--line2)',
              background: over ? 'var(--bay-soft)' : undefined,
              color: over ? 'var(--bay-ink)' : 'var(--muted)',
            }}
            onDragOver={(e) => {
              e.preventDefault()
              if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
              drag.onOver(`zone:${z.key}`)
            }}
            onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget) && drag.onOver(null)}
            onDrop={(e) => {
              e.preventDefault()
              drag.onDropZone(z)
            }}
          >
            Drop here: {z.stage}
          </div>
        )
      })}
    </div>
  )
}

const demoAge = (days) => new Date(Date.now() - days * 86_400_000).toISOString()

const demoRows = [
  {
    id: 'd1', stage: 'Application Received', name: 'Ramirez · Purchase', phone: '(713) 555-0142',
    last_touch_at: null, crm_profile_url: '#',
    docs_tracked: true, docs_outstanding: ['Paystubs', 'W2', 'Bank Statements'],
    docs_outstanding_count: 3, docs_oldest_requested_at: demoAge(12),
    doc_notes: 'Employer reissuing the W2 — chasing weekly',
    last_note_snippet: 'Sending W2 tomorrow, has to dig up the 2024 one',
    last_note_at: demoAge(2),
  },
  {
    id: 'd2', stage: 'Application/Estimate Sent', name: 'Nguyen · Refi', phone: '(281) 555-0195',
    last_touch_at: null, crm_profile_url: '#',
    docs_tracked: true, docs_outstanding: [], docs_outstanding_count: 0,
    docs_oldest_requested_at: null,
    last_note_snippet: 'Locked rate, clear to close', last_note_at: demoAge(1),
  },
  {
    id: 'd3', stage: 'Application/Estimate Sent', name: 'Okafor · Purchase', phone: '(832) 555-0110',
    last_touch_at: null, crm_profile_url: '#',
    docs_tracked: false, docs_outstanding: [], docs_outstanding_count: 0,
    docs_oldest_requested_at: null, last_note_snippet: null, last_note_at: null,
  },
]

// Per-business query + presentation config. MPG reads Zoho leads through
// v_mpg_contacts (0 deals today — the pipeline lives on leads); Bayway reads
// the FUB-derived v_active_pipeline. flowOrder curates the column order.
const HEALTH_COLUMNS = ', stage_since, crm_created_at, last_outbound_call_at, open_task_count, oldest_open_due_at'

const PIPELINE = {
  bay: {
    view: 'v_active_pipeline',
    columns:
      'id, business_id, name, email, phone, last_touch_at, stage, crm_profile_url, ' +
      'docs_tracked, docs_outstanding, docs_outstanding_count, docs_oldest_requested_at, ' +
      'doc_notes, last_note_snippet, last_note_at' + HEALTH_COLUMNS,
    flowOrder: undefined, // default LOAN_FLOW_ORDER
    countLabel: 'active',
    empty: 'No active loans — add stages in FollowUpBoss.',
  },
  mpg: {
    view: 'v_mpg_contacts',
    columns: 'id, name, company, email, phone, last_touch_at, stage, crm_profile_url' + HEALTH_COLUMNS,
    flowOrder: MPG_LEAD_FLOW,
    countLabel: 'leads',
    empty: 'No MPG leads yet — add them in Zoho CRM.',
  },
}

// A small pick-one sheet: which tag was sent (Application/Estimate Sent holds
// Smart Lists 04 / 05), or why a lead is lost.
function PickSheet({ title, subtitle, options, onPick, onCancel }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-label={title}
        className="w-full rounded-t-2xl border border-line bg-panel p-5 sm:max-w-sm sm:rounded-card"
        style={{ borderTop: '3px solid var(--bay)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-[15px] font-bold">{title}</div>
        <div className="mt-0.5 text-[12px] text-muted">{subtitle}</div>
        <div className="mt-3 flex flex-col gap-2">
          {options.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => onPick(c.key)}
              className="min-h-[44px] rounded-[10px] border border-line2 text-[13.5px] font-semibold hover:bg-hoverbg"
            >
              {c.label}
            </button>
          ))}
          <button type="button" onClick={onCancel} className="min-h-[40px] text-[12.5px] text-muted">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Pipeline({ biz }) {
  const cfg = PIPELINE[biz] || PIPELINE.bay
  // Same rules as Up Next, so a red card and an Up Next "Stuck" row agree.
  const { rules } = usePriorityQueue()
  const now = useNow(30_000)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(!isDemoMode)
  const [error, setError] = useState(null)
  // Drag between stages: Bayway only, writes FUB tags via crm-action set_stage
  // (same as Quick Actions' Move stage). Touch screens use Move stage instead.
  const flags = useWritebackFlags()
  const canDrag = biz === 'bay' && !isDemoMode && flags.bay === true
  const [pending, setPending] = useState({})
  const [dragging, setDragging] = useState(null)
  const [over, setOver] = useState(null)
  const [choice, setChoice] = useState(null)
  // A move that leaves the lead with nothing scheduled offers a follow-up.
  // Held here, not in the card: the reload redraws the card in its new column.
  const [prompt, setPrompt] = useState(null)
  // A drop on the Lost zone: ask why before writing.
  const [lostAsk, setLostAsk] = useState(null)

  // quiet: refresh after a Quick Action without swapping the board for the
  // loading state (which would unmount the card that fired it).
  const load = useCallback(async ({ quiet = false } = {}) => {
    if (isDemoMode) return
    if (!quiet) setLoading(true)
    setError(null)
    try {
      const { data, error: err } = await fetchAllSettled(() => {
        const q = supabase.from(cfg.view).select(cfg.columns).order('id')
        return biz === 'bay' ? q.eq('business_id', 'bay') : q
      })
      if (err) {
        setError(err.message)
        return
      }
      setRows(data || [])
    } catch (e) {
      setError(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }, [biz, cfg.view, cfg.columns])

  useEffect(() => {
    load()
  }, [load])

  // New leads and finished calls show up without a reload while the board is open.
  useEffect(() => {
    const id = setInterval(() => document.visibilityState === 'visible' && load({ quiet: true }), 60_000)
    return () => clearInterval(id)
  }, [load])

  // undo: putting a lead back after Lost; quiet, so no next-step offer.
  const moveTo = async (row, targetKey, stage, { reason, undo = false } = {}) => {
    setPending((p) => ({ ...p, [row.id]: stage }))
    const res = await invokeCrmAction(
      buildActionRequest({ action: 'set_stage', contactId: row.id, target: targetKey, reason }),
    )
    const summary = summarizeResult(res, 'bay')
    const name = row.name || 'Lead'
    // The tag move is what matters; a failed Lost note still counts as moved.
    const moved = Array.isArray(res?.results) ? res.results.find((r) => r.step === 'set_stage') : null
    if (moved?.ok) {
      if (targetKey === 'lost') {
        const back = moved.previous_target || dropTargetFor(row.stage)?.key
        showToast({
          ...summary,
          text: summary.tone === 'ok' ? `${name} marked Lost in FollowUpBoss` : summary.text,
          ...(back && { action: { label: 'Undo', run: () => moveTo(row, back, row.stage, { undo: true }) }, duration: 10_000 }),
        })
      } else {
        showToast({ ...summary, text: summary.tone === 'ok' ? `${name} moved to ${stage} in FollowUpBoss` : summary.text })
      }
      if (!undo && needsNextStepPrompt(targetKey, row.open_task_count)) setPrompt(row)
      await load({ quiet: true })
    } else {
      showToast({ ...summary, retry: () => moveTo(row, targetKey, stage, { reason, undo }) })
    }
    // Drop the override last: on success the reload already shows the new
    // stage; on failure the card snaps back to where it was.
    setPending((p) => {
      const next = { ...p }
      delete next[row.id]
      return next
    })
  }

  const drag = canDrag
    ? {
        draggingId: dragging,
        draggingStage: rows.find((r) => r.id === dragging)?.stage ?? null,
        over,
        onStart: (id) => setDragging(id),
        onEnd: () => {
          setDragging(null)
          setOver(null)
        },
        onOver: (stage) => setOver(stage),
        onDrop: (stage) => {
          const row = rows.find((r) => r.id === dragging)
          setDragging(null)
          setOver(null)
          if (!row || row.stage === stage || pending[row.id]) return
          const target = dropTargetFor(stage)
          if (!target) return
          if (target.key) moveTo(row, target.key, stage)
          else setChoice({ row, stage, choices: target.choose })
        },
        onDropZone: (zone) => {
          const row = rows.find((r) => r.id === dragging)
          setDragging(null)
          setOver(null)
          if (!row || row.stage === zone.stage || pending[row.id]) return
          if (zone.needsReason) setLostAsk(row)
          else moveTo(row, zone.key, zone.stage)
        },
      }
    : null

  if (isDemoMode && biz !== 'mpg') {
    return (
      <div>
        <BizHeader biz="bay" note={<span className="text-xs text-dim">demo</span>} />
        <Board columns={buildColumns(demoRows)} biz="bay" />
      </div>
    )
  }

  // The draggable Bayway board shows every column, so empty stages take drops.
  // A lead on its way to Lost leaves the board at once.
  const visible = rows.filter((r) => pending[r.id] !== 'Lost')
  const columns = buildColumns(withPendingMoves(visible, pending), cfg.flowOrder, {
    showAllFlow: canDrag,
    sortCards: (cards) => sortByHealth(cards, rules, now),
  })

  return (
    <div>
      <BizHeader
        biz={biz}
        note={
          !loading && !error && (
            <span className="num text-[12px] text-muted">
              {rows.length} {cfg.countLabel}
            </span>
          )
        }
      />

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {loading && <div className="mt-6 text-sm text-muted">Loading pipeline…</div>}

      {!loading && !error && rows.length === 0 && (
        <div className="mt-6 rounded-card border border-line bg-panel px-6 py-10 text-center text-sm text-muted">
          {cfg.empty}
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <Board
          columns={columns}
          biz={biz}
          onDone={() => load({ quiet: true })}
          onPrompt={setPrompt}
          drag={drag}
          rules={rules}
          now={now}
        />
      )}
      <DropZones drag={drag} />
      {choice && (
        <PickSheet
          title="Which was sent?"
          subtitle={`${choice.row.name || 'This lead'} · Application/Estimate Sent`}
          options={choice.choices}
          onCancel={() => setChoice(null)}
          onPick={(key) => {
            const c = choice
            setChoice(null)
            moveTo(c.row, key, c.stage)
          }}
        />
      )}
      {lostAsk && (
        <PickSheet
          title="Why is this lead lost?"
          subtitle={`${lostAsk.name || 'This lead'} · leaves the board, tagged Lost in FollowUpBoss`}
          options={LOST_REASONS.map((r) => ({ key: r, label: r }))}
          onCancel={() => setLostAsk(null)}
          onPick={(reason) => {
            const row = lostAsk
            setLostAsk(null)
            moveTo(row, 'lost', 'Lost', { reason })
          }}
        />
      )}
      {prompt && (
        <NextStepPrompt
          businessId="bay"
          contactId={prompt.id}
          contactName={prompt.name}
          onClose={() => setPrompt(null)}
          onDone={() => load({ quiet: true })}
        />
      )}
    </div>
  )
}
