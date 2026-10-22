// The Workbench Work lane: three groups of file work (workbench.js), each item
// with Open (person sheet) and, where a CRM step finishes it, Done:
//   estimate   -> "Estimate sent" / "Application sent" (FUB stage tag)
//   mpg_task   -> completes the Zoho task
//   application: Open only until "Mark reviewed" (weekly review, slice 3)
import { useState } from 'react'
import { invokeCrmAction, useWritebackFlags } from '../lib/writeback'
import { buildActionRequest, summarizeResult } from '../lib/crmActions'
import BizBadge from './BizBadge'
import PersonSheet from './PersonSheet'
import { Sheet, quickActionTone } from './QuickActions'
import { showToast } from './Toaster'

const BOOK_OF = { estimate: 'bay', application: 'bay', mpg_task: 'mpg' }
const SENT = [
  { key: 'estimate_sent', label: 'Estimate sent' },
  { key: 'application_sent', label: 'Application sent' },
]

export default function WorkLane({ groups, onChanged }) {
  const flags = useWritebackFlags()
  const [personId, setPersonId] = useState(null)
  const [picking, setPicking] = useState(null)
  const [busy, setBusy] = useState(null)

  const run = async (item, request, okText) => {
    setBusy(item.key)
    const res = await invokeCrmAction(request)
    setBusy(null)
    const summary = summarizeResult(res, BOOK_OF[item.kind])
    showToast(summary.tone === 'ok' && okText ? { ...summary, text: okText } : summary)
    if (summary.tone !== 'error') onChanged?.()
  }

  const done = (item) => {
    if (item.kind === 'estimate') setPicking(item)
    else if (item.kind === 'mpg_task') run(item, buildActionRequest({ action: 'complete_task', taskId: item.taskId }))
  }

  const sent = (target) => {
    const item = picking
    setPicking(null)
    run(item, buildActionRequest({ action: 'set_stage', contactId: item.contactId, target: target.key }), `${item.name} moved to ${target.label} in FollowUpBoss`)
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => (
        <div key={g.id} className="overflow-hidden rounded-card border border-line bg-panel">
          <div className="flex items-center gap-2 border-b border-line px-4 py-3">
            <BizBadge biz={g.book} />
            <h2 className="text-[15px] font-bold">{g.title}</h2>
            <span className="num text-[12.5px] font-semibold text-muted">{g.items.length}</span>
          </div>
          {g.items.length === 0 && <div className="px-4 py-3 text-[13px] text-muted">Nothing here right now.</div>}
          {g.items.map((it) => {
            const canDone = (it.kind === 'estimate' || it.kind === 'mpg_task') && flags[BOOK_OF[it.kind]] === true
            return (
              <div key={it.key} data-work-item className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-3 last:border-b-0">
                <div className="min-w-0 flex-[1_1_220px]">
                  <div className="text-[14px] font-semibold">{it.title}</div>
                  <div className="truncate text-[12.5px] text-muted">{it.name}</div>
                  <div className={`text-[12.5px] font-semibold ${it.late ? '' : 'text-muted'}`} style={it.late ? { color: 'var(--neg-ink)' } : undefined}>
                    {it.why}
                  </div>
                </div>
                <div className="flex flex-none gap-1.5">
                  {it.contactId && (
                    <button type="button" onClick={() => setPersonId(it.contactId)} className="min-h-[40px] rounded-[10px] border border-line2 px-3 text-[13px] font-semibold">
                      Open
                    </button>
                  )}
                  {canDone && (
                    <button
                      type="button"
                      disabled={busy === it.key}
                      onClick={() => done(it)}
                      className="min-h-[40px] rounded-[10px] px-3 text-[13px] font-semibold text-white disabled:opacity-50"
                      style={{ background: 'var(--text)' }}
                    >
                      Done
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ))}
      {picking && (
        <Sheet title="What did you send?" subtitle={`${picking.name} · moves the lead in FollowUpBoss`} t={quickActionTone('bay')} onClose={() => setPicking(null)}>
          <div className="flex flex-col gap-2">
            {SENT.map((s) => (
              <button key={s.key} type="button" onClick={() => sent(s)} className="min-h-[44px] rounded-[10px] border border-line2 text-[13.5px] font-semibold">
                {s.label}
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {personId && <PersonSheet id={personId} onClose={() => setPersonId(null)} />}
    </div>
  )
}
