// Workbench v2 Next up (spec 2026-11-23, §5): one item at a time from the list
// being worked. The model comes from workNext.js; this card draws it and its
// last three touches, and hands the actions back to Workbench.
//   Call        tel: link with callAttrs, so the after-call sheet asks how it went
//   Call agent  the buyer's agent on a loan file
//   Done        calls: the Log call sheet (crm-action); files: jump to the row
//   Snooze      calls: Not today; files: check back tomorrow
// Keys: Shift+D done, Shift+S snooze, J next, Z undo (Workbench listens).
import { useEffect, useState } from 'react'
import { supabase, isDemoMode } from '../lib/supabase'
import { callAttrs } from '../lib/pendingCall'
import { formatPhone, telHref } from '../lib/phone'
import QuickActions from './QuickActions'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const TYPE = { call: 'Call', text: 'Text', email: 'Email', note: 'Note', event: 'Meeting' }

// The person's last three logged touches.
function useLastTouches(contactId) {
  const [rows, setRows] = useState([])
  useEffect(() => {
    setRows([])
    if (!contactId || isDemoMode) return
    let live = true
    Promise.resolve(
      supabase.from('activities').select('id, type, occurred_at, notes').eq('contact_id', contactId).order('occurred_at', { ascending: false }).limit(3),
    )
      .then((res) => live && setRows(res?.data || []))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [contactId])
  return rows
}

const OUTLINE = 'min-h-[44px] rounded-lg border border-[#4A5263] px-4 text-ui font-semibold text-white hover:bg-white/10'

export default function NextUpCard({ pick, model, value, logging, onDone, onLogged, onLogClose, onSnooze, onNext, onUndo, canUndo }) {
  const touches = useLastTouches(model?.contactId)
  if (!pick || !model) {
    return (
      <section aria-label="Next up" className="rounded-2xl bg-[#14171F] px-6 py-5 text-white">
        <div className="text-ui font-semibold">Nothing left in today&apos;s lists.</div>
        <div className="mt-1 text-body text-[#B9BFCC]">New work shows up here as it comes in.</div>
      </section>
    )
  }
  const first = model.name.split(/\s+/)[0]
  const tel = telHref(model.phone)
  const agentTel = telHref(model.agent?.phone)
  return (
    <section aria-label="Next up" data-next-up={model.key} className="flex flex-col gap-3.5 rounded-2xl bg-[#14171F] px-6 py-5 text-white">
      <div className="flex flex-wrap items-center gap-2.5 text-body text-[#B9BFCC]">
        <span className="rounded-md bg-[#2B3140] px-2.5 py-1 font-semibold text-white">Next up · {pick.label}</span>
        <span>
          {[model.task, model.book === 'mpg' ? 'MPG' : model.book === 'bay' ? 'Bayway' : null, model.est].filter(Boolean).join(' · ')}
        </span>
        <span className="text-caption">{pick.left} in {pick.label}</span>
        {value && (
          <span className="ml-auto flex items-baseline gap-2">
            <span>{value.exact ? 'Commission in Arive' : 'Est. value'}</span>
            <span className="num text-[20px] font-bold text-white">{value.text}</span>
          </span>
        )}
      </div>

      <div>
        <h2 className="text-[26px] font-bold tracking-[-0.4px]">{model.name}</h2>
        {model.why && <p className="mt-1 text-ui text-[#DDE1E8]">{model.why}</p>}
      </div>

      <div className="flex flex-wrap gap-5">
        <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-2.5">
          {model.chips.length > 0 && (
            <div className="flex flex-wrap gap-2 text-body">
              {model.chips.map((c) => (
                <span key={c} className="rounded-md border border-[#3A4152] px-2.5 py-1">
                  {c}
                </span>
              ))}
            </div>
          )}
          {model.agent && (
            <div className="text-body text-[#DDE1E8]">
              <span className="text-[#8E95A4]">Buyer&apos;s agent</span> {model.agent.name}
              {model.agent.company && ` · ${model.agent.company}`}
              {model.agent.phone && ` · ${formatPhone(model.agent.phone)}`}
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-2 border-[#2B3140] md:border-l md:pl-5">
          <span className="text-caption font-semibold text-[#8E95A4]">Last touches</span>
          {touches.length === 0 && <span className="text-body text-[#8E95A4]">None logged yet</span>}
          {touches.map((t) => {
            const d = t.occurred_at ? new Date(t.occurred_at) : null
            return (
              <div key={t.id} data-touch className="flex gap-2.5 text-body">
                <span className="w-[52px] flex-none text-[#8E95A4]">{d ? `${MONTHS[d.getMonth()]} ${d.getDate()}` : ''}</span>
                <span className="min-w-0 truncate text-[#DDE1E8]">
                  {TYPE[t.type] || t.type || 'Touch'}
                  {t.notes && ` · ${t.notes}`}
                </span>
              </div>
            )
          })}
          {(model.tasks != null || model.docs != null) && (
            <span className="text-caption text-[#8E95A4]">
              {[model.tasks != null && `Open tasks: ${model.tasks || 'none'}`, model.docs != null && `Docs missing: ${model.docs || 'none'}`].filter(Boolean).join(' · ')}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        {tel && (
          <a
            href={tel}
            {...callAttrs({ id: model.contactId, book: model.book, name: model.name })}
            className="inline-flex min-h-[48px] items-center rounded-lg bg-white px-5 text-ui font-semibold text-[#14171F]"
          >
            Call {first} · {formatPhone(model.phone)}
          </a>
        )}
        {agentTel && (
          <a href={agentTel} className={`inline-flex items-center ${OUTLINE}`}>
            Call agent
          </a>
        )}
        <button type="button" data-next-done onClick={onDone} className={OUTLINE}>
          {model.kind === 'file' ? 'Open in Files' : 'Done'}
        </button>
        <button type="button" data-next-snooze onClick={onSnooze} className="min-h-[44px] rounded-lg px-3 text-ui font-semibold text-[#B9BFCC] hover:bg-white/10">
          Snooze
        </button>
        <button type="button" data-next-skip onClick={onNext} className="min-h-[44px] rounded-lg px-3 text-ui font-semibold text-[#B9BFCC] hover:bg-white/10">
          Next
        </button>
        {canUndo && (
          <button type="button" data-next-undo onClick={onUndo} className="min-h-[44px] rounded-lg px-3 text-ui font-semibold text-[#B9BFCC] hover:bg-white/10">
            Undo
          </button>
        )}
        <span className="ml-auto hidden text-caption text-[#8E95A4] md:inline">Shift+D done · Shift+S snooze · J next · Z undo</span>
      </div>

      {logging && model.kind === 'call' && (
        <QuickActions
          businessId={model.book}
          contactId={model.contactId}
          contactName={model.name}
          hasPhone={!!model.phone}
          stage={model.stage}
          cadence={model.cadence}
          only={[]}
          autoOpen="call"
          onDone={onLogged}
          onSheetClose={onLogClose}
        />
      )}
    </section>
  )
}
