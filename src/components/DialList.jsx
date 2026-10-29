// The Calls lane's "Lead cadence" section (spec: The daily list): leads due
// now, then later today, each with its attempt pips and a call link. Start
// dialing / a row opens the Dialer at that lead.
import PersonLink from './PersonLink'
import BizBadge from './BizBadge'
import { telHref } from '../lib/phone'
import { ATTEMPTS, whenLabel } from '../lib/dialList'

export function Pips({ item }) {
  if (item.kind !== 'attempt' && item.kind !== 'move_nurture') return null
  return (
    <span className="inline-flex gap-[3px] align-middle" aria-label={`${item.calls} of ${ATTEMPTS} attempts`}>
      {Array.from({ length: ATTEMPTS }, (_, i) => (
        <span key={i} data-pip={i < item.calls ? 'on' : 'off'} className={`h-[7px] w-[7px] rounded-full border ${i < item.calls ? 'border-[color:var(--chrome)] bg-[color:var(--chrome)]' : 'border-line2'}`} />
      ))}
    </span>
  )
}

function Row({ item, index, now, onDial }) {
  const r = item.row
  const tel = telHref(r.phone)
  return (
    // The row opens the dialer; the name (PersonLink, its own button that stops
    // propagation) opens the contact card. A div, so no button nests in a button.
    <div data-dial-row className="flex items-center gap-3 border-b border-line px-4 py-2.5">
      <div role="button" tabIndex={0} onClick={() => onDial(index)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onDial(index)} className="min-w-0 flex-1 cursor-pointer text-left" aria-label={`Dial ${r.name || 'lead'}`}>
        <div className="flex min-w-0 items-center gap-2">
          <BizBadge biz={item.book} />
          <PersonLink id={r.id} url={r.crm_profile_url} className="min-w-0 truncate text-[14px] font-semibold">{r.name || '(no name)'}</PersonLink>
          {r.lead_source && <span className="max-w-[120px] flex-none truncate rounded-full border border-line2 px-2 text-[11px] font-semibold text-muted">{r.lead_source}</span>}
        </div>
        <div className="mt-1 flex items-center gap-2 text-[12.5px] text-muted">
          <Pips item={item} />
          <span>{[item.label, whenLabel(item, now), item.hint].filter(Boolean).join(' · ')}</span>
        </div>
      </div>
      {tel && (
        <a href={tel} aria-label={`Call ${r.name || 'lead'}`} className="grid h-10 w-10 flex-none place-items-center rounded-[10px] text-muted hover:bg-hoverbg">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" /></svg>
        </a>
      )}
    </div>
  )
}

// dueNow / laterToday: buildDialList output. onDial(index): open the dialer at
// that position in [...dueNow, ...laterToday].
export default function DialList({ dueNow, laterToday, now = Date.now(), onDial }) {
  const all = [...dueNow, ...laterToday]
  return (
    <section aria-label="Lead cadence">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 pb-1.5 pt-3">
        <div className="text-[12px] font-bold uppercase tracking-wide text-muted">
          Lead cadence <span className="num font-semibold text-dim">{dueNow.length}</span>
          {laterToday.length > 0 && <span className="font-semibold normal-case text-dim"> · {laterToday.length} later today</span>}
        </div>
        {all.length > 0 && (
          <button type="button" data-start-dialing onClick={() => onDial(0)} className="min-h-[34px] rounded-[10px] px-3 text-[13px] font-bold text-white" style={{ background: 'var(--chrome)' }}>
            Start dialing
          </button>
        )}
      </div>
      {all.length === 0 && <div className="border-b border-line px-4 py-3 text-[13px] text-muted">No lead calls due right now.</div>}
      {all.map((it, i) => <Row key={`${it.id}:${it.kind}:${it.step}`} item={it} index={i} now={now} onDial={onDial} />)}
    </section>
  )
}
