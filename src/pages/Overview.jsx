import { useBusiness } from '../context/BusinessContext'
import BizBadge from '../components/BizBadge'

// Phase 1 shell version of the Overview.
// KPI cards and the workbench render from this placeholder array until the
// sync layer (Phase 2) starts writing real Zoho / FollowUpBoss rows.
const placeholderDeals = [
  { id: 1, biz: 'mpg', title: 'Bayou City Auto Repair', sub: 'Merchant services · est. $310/mo', stage: 'Discovery / Statement', date: 'Today' },
  { id: 2, biz: 'bay', title: 'Ramirez · $340K Purchase', sub: 'Conventional · ref: K. Pham', stage: 'Clear to Close', date: 'Feb 26' },
  { id: 3, biz: 'mpg', title: 'Lone Star BBQ Supply', sub: 'Displacement · est. $520/mo', stage: 'Analysis & Proposal', date: 'Feb 25' },
  { id: 4, biz: 'bay', title: 'Nguyen · $215K Refi', sub: 'Rate/term · ref: direct', stage: 'Processing', date: 'Feb 27' },
]

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export default function Overview() {
  const { biz, matches } = useBusiness()
  const deals = placeholderDeals.filter((d) => matches(d.biz))
  const mpgCount = placeholderDeals.filter((d) => d.biz === 'mpg').length
  const bayCount = placeholderDeals.filter((d) => d.biz === 'bay').length

  return (
    <div>
      <h2 className="text-[28px] font-bold tracking-tight">{greeting()}, Chandler</h2>
      <p className="mt-1 text-sm text-muted">
        {biz === 'mpg'
          ? 'MPG view — merchant services only.'
          : biz === 'bay'
            ? 'Bayway view — mortgage only.'
            : 'Here is what is happening across MPG and Bayway today.'}
      </p>

      {/* KPI row - counts come alive in Phase 3 once synced data exists */}
      <div className="mt-6 grid grid-cols-2 gap-3.5 xl:grid-cols-4">
        <Kpi label="Active deals" value={deals.length} split={biz === 'all' ? { mpg: mpgCount, bay: bayCount } : null} />
        <Kpi label="Pipeline value" value="—" note="Phase 2 sync" />
        <Kpi label="Follow-ups due today" value="—" note="Phase 2 sync" />
        <Kpi label="Closed this month" value="—" note="Phase 2 sync" />
      </div>

      {/* Workbench */}
      <div className="mt-5 rounded-card border border-line bg-panel">
        <div className="flex items-center justify-between border-b border-line px-4 py-3.5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <span className="grad-dual h-[7px] w-[7px] rounded-full" />
            Active Workbench
            <span className="num text-[11px] font-medium text-muted">
              {deals.length} / {placeholderDeals.length}
            </span>
          </div>
          <span className="text-xs text-dim">Placeholder rows until Phase 2 sync</span>
        </div>
        {deals.map((d) => (
          <div
            key={d.id}
            className="relative flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0 hover:bg-hoverbg"
          >
            <span
              className="absolute bottom-2 left-0 top-2 w-[3px] rounded-sm"
              style={{ background: d.biz === 'mpg' ? 'var(--mpg)' : 'var(--bay)' }}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13.5px] font-semibold">{d.title}</div>
              <div className="mt-0.5 flex items-center gap-2 text-[11.5px] text-muted">
                <BizBadge biz={d.biz} />
                {d.sub}
              </div>
            </div>
            <span
              className="whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold"
              style={{
                background: d.biz === 'mpg' ? 'var(--mpg-soft)' : 'var(--bay-soft)',
                color: d.biz === 'mpg' ? 'var(--mpg)' : 'var(--bay)',
              }}
            >
              {d.stage}
            </span>
            <span
              className={`w-16 whitespace-nowrap text-right text-[11.5px] ${
                d.date === 'Today' ? 'font-semibold' : 'text-muted'
              }`}
              style={d.date === 'Today' ? { color: 'var(--bay-gold)' } : undefined}
            >
              {d.date}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Kpi({ label, value, split, note }) {
  return (
    <div className="rounded-card border border-line bg-panel p-4">
      <div className="num text-[30px] font-bold leading-none tracking-tight">{value}</div>
      <div className="mt-1.5 text-xs text-muted">{label}</div>
      {split && (
        <div className="mt-3 flex gap-3.5 border-t border-line pt-2.5 text-[11.5px] text-muted">
          <span className="flex items-center gap-1.5">
            <i className="h-[7px] w-[7px] rounded-sm" style={{ background: 'var(--mpg)' }} />
            MPG <b className="num font-semibold text-white">{split.mpg}</b>
          </span>
          <span className="flex items-center gap-1.5">
            <i className="h-[7px] w-[7px] rounded-sm" style={{ background: 'var(--bay)' }} />
            Bayway <b className="num font-semibold text-white">{split.bay}</b>
          </span>
        </div>
      )}
      {note && <div className="mt-3 border-t border-line pt-2.5 text-[11px] text-dim">{note}</div>}
    </div>
  )
}
