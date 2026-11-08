// Overview: expected payout this month and next (forecast.js). Bayway is
// funded + weighted pipeline; MPG is expected accounts until residuals exist.
import { Link } from 'react-router-dom'
import { forecastByMonth, monthKeyOf } from '../lib/forecast'

const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`

function Column({ label, f, biz, pastDue = 0 }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="text-caption font-semibold text-muted">{label}</div>
      {biz !== 'mpg' && (
        <div className="mt-1">
          <div className="num text-title font-bold">{money(f.bay.expected)}</div>
          <div className="text-caption text-muted">
            Bayway · funded {money(f.bay.funded)} · weighted {money(f.bay.weighted)}
            {f.bay.est > 0 && ` · ${f.bay.est} est.`}
            {pastDue > 0 && ` · ${pastDue} past due`}
          </div>
        </div>
      )}
      {biz !== 'bay' && (
        <div className="mt-2 text-body">
          MPG ·{' '}
          {f.mpg.expected != null ? (
            <span className="num font-semibold">
              {money(f.mpg.expected)}
              {f.mpg.est > 0 && ' est.'}
            </span>
          ) : (
            <span className="num font-semibold">{f.mpg.accounts} accounts expected</span>
          )}
        </div>
      )}
    </div>
  )
}

export default function ForecastCard({ forecast, biz, now = Date.now() }) {
  const { lines, loading, error } = forecast
  const thisKey = monthKeyOf(now)
  const thisMonth = forecastByMonth(lines, thisKey)
  const nextMonth = forecastByMonth(lines, monthKeyOf(now, 1))
  // Overdue lines are counted in this month, so they show on its Bayway line.
  const pastDue = lines.filter((l) => l.overdue && l.month === thisKey && l.book === 'bay').length
  // Undated is the same for every month, so it shows once, under both. It
  // counts Bayway (Arive) loans, so the MPG view leaves it out.
  const undated = biz === 'mpg' ? 0 : thisMonth.undated.count
  return (
    <section data-card="forecast" className="rounded-card border border-line bg-panel p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-ui font-semibold">Forecast</h3>
        <Link to="/settings" className="text-caption text-muted hover:text-[color:var(--text)]">
          Odds
        </Link>
      </div>
      {error && <div className="mt-2 text-caption text-neg-ink">{error}</div>}
      {loading ? (
        <div className="mt-3 text-body text-muted">Loading…</div>
      ) : (
        <>
          <div className="mt-3 flex gap-6">
            <Column label="This month" f={thisMonth} biz={biz} pastDue={pastDue} />
            <Column label="Next month" f={nextMonth} biz={biz} />
          </div>
          {undated > 0 && (
            <div className="mt-3 text-caption text-muted">
              {undated} open loan{undated === 1 ? '' : 's'} with no closing date
            </div>
          )}
        </>
      )}
    </section>
  )
}
