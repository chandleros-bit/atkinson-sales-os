// The Workbench alerts rail: one slim tile per thing that is slipping
// (alerts.js): its count, title and the first few names on one line (each
// opens the contact card); the why is the tile's tooltip. Renders nothing when
// all is well.
import { Fragment } from 'react'
import BizBadge from './BizBadge'
import PersonLink from './PersonLink'
import { PILL_TONE } from './HealthPills'

export default function AlertsRail({ alerts, showBook }) {
  if (!alerts.length) return null
  return (
    <section aria-label="Alerts" className="grid flex-none grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
      {alerts.map((a) => (
        <div
          key={a.id}
          data-alert={a.id}
          title={a.hint}
          className="flex min-h-[62px] items-center gap-3 rounded-xl border border-line bg-panel px-3.5 py-2 shadow-[0_1px_2px_rgba(16,24,40,.05)]"
        >
          <span className="num grid h-[34px] min-w-[34px] flex-none place-items-center rounded-[9px] px-1.5 text-[16px] font-bold" style={PILL_TONE[a.tone]} data-alert-count>
            {a.count}
          </span>
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold leading-tight">{a.title}</div>
            <div className="mt-0.5 flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap text-[12.5px] text-muted">
              {a.people.map((p, i) => (
                <Fragment key={`${p.id || 'x'}-${i}`}>
                  {i > 0 && <span aria-hidden="true">·</span>}
                  {showBook && a.book == null && p.book && <BizBadge biz={p.book} />}
                  <PersonLink id={p.id} className="min-w-0 truncate">
                    {p.name}
                  </PersonLink>
                </Fragment>
              ))}
              {a.more > 0 && <span className="flex-none text-dim">· +{a.more}</span>}
            </div>
          </div>
        </div>
      ))}
    </section>
  )
}
