// The Workbench alerts rail: one card per thing that is slipping (alerts.js),
// with its count, why, and the first few names (each opens the contact card).
// Renders nothing when all is well.
import BizBadge from './BizBadge'
import PersonLink from './PersonLink'
import { PILL_TONE } from './HealthPills'

export default function AlertsRail({ alerts, showBook }) {
  if (!alerts.length) return null
  return (
    <section aria-label="Alerts" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
      {alerts.map((a) => (
        <div key={a.id} data-alert={a.id} className="rounded-card border border-line bg-panel px-4 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="num rounded-[9px] px-2 py-0.5 text-[15px] font-extrabold" style={PILL_TONE[a.tone]} data-alert-count>
              {a.count}
            </span>
            <span className="min-w-0 text-[13.5px] font-semibold leading-tight">{a.title}</span>
          </div>
          <div className="mt-1.5 text-[12px] text-muted">{a.hint}</div>
          <ul className="mt-2 flex flex-col gap-1">
            {a.people.map((p, i) => (
              <li key={`${p.id || 'x'}-${i}`} className="flex min-w-0 items-center gap-1.5 text-[12.5px]">
                {showBook && a.book == null && p.book && <BizBadge biz={p.book} />}
                <PersonLink id={p.id} className="min-w-0 truncate font-semibold">
                  {p.name}
                </PersonLink>
              </li>
            ))}
            {a.more > 0 && <li className="text-[12px] text-dim">+{a.more} more</li>}
          </ul>
        </div>
      ))}
    </section>
  )
}
