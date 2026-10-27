// The Workbench alerts rail: one tile per thing that is slipping (alerts.js):
// its count and title, then a preview of the first three people, each with a
// one-line why (each name opens the contact card). Show more lists the rest in
// the tile. The tile's tooltip is the alert's rule. Renders nothing when all
// is well.
import { useState } from 'react'
import BizBadge from './BizBadge'
import PersonLink from './PersonLink'
import { PILL_TONE } from './HealthPills'

function Person({ p, badge }) {
  return (
    <li className="flex min-w-0 items-center gap-2 text-[12.5px] leading-5">
      {badge && p.book && <BizBadge biz={p.book} />}
      {/* The name keeps its room; the why gives way first. */}
      <PersonLink id={p.id} className="max-w-[65%] flex-none truncate text-[13px] font-semibold text-[color:var(--text)]">
        {p.name}
      </PersonLink>
      {p.detail && <span className="ml-auto min-w-0 truncate text-right text-dim">{p.detail}</span>}
    </li>
  )
}

function AlertTile({ a, showBook }) {
  const [open, setOpen] = useState(false)
  const badge = showBook && a.book == null
  return (
    <div data-alert={a.id} title={a.hint} className="flex min-w-0 flex-col rounded-xl border border-line bg-panel px-3.5 py-3 shadow-[0_1px_2px_rgba(16,24,40,.05)]">
      <div className="flex items-center gap-2.5">
        <span className="num grid h-[30px] min-w-[30px] flex-none place-items-center rounded-[8px] px-1.5 text-[15px] font-bold" style={PILL_TONE[a.tone]} data-alert-count>
          {a.count}
        </span>
        <span className="min-w-0 truncate text-[14px] font-semibold">{a.title}</span>
      </div>
      <ul aria-label={`${a.title}: people`} className={`mt-2 flex flex-col gap-0.5 ${open ? 'max-h-[176px] overflow-y-auto pr-1' : ''}`}>
        {(open ? [...a.people, ...(a.rest || [])] : a.people).map((p, i) => (
          <Person key={`${p.id || 'x'}-${i}`} p={p} badge={badge} />
        ))}
      </ul>
      {a.more > 0 && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="mt-1.5 self-start text-[12.5px] font-semibold text-[color:var(--chrome)] hover:underline"
        >
          {open ? 'Show less' : `Show ${a.more} more`}
        </button>
      )}
    </div>
  )
}

export default function AlertsRail({ alerts, showBook }) {
  if (!alerts.length) return null
  return (
    <section aria-label="Alerts" className="grid flex-none grid-cols-1 items-start gap-3 sm:grid-cols-2 xl:grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
      {alerts.map((a) => (
        <AlertTile key={a.id} a={a} showBook={showBook} />
      ))}
    </section>
  )
}
