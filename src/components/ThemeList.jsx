// The day's theme list (spec: Weekday themes): a Mon-Fri strip with each
// day's theme and how many are due, then the picked day's people with a call
// link. Start dialing / a row opens the Dialer on this list.
import PersonLink from './PersonLink'
import { SECTION_HEAD, SectionTitle } from './CallSection'
import { AgentLines } from './AgentCalls'
import { telHref } from '../lib/phone'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const CallIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" /></svg>
)

// list: buildThemeList output. pickedDay: the previewed weekday or null (today).
// agents / agentsChecked: useLoanAgents, for the loan-status rows.
export default function ThemeList({ list, pickedDay = null, onPickDay, onDial, agents = null, agentsChecked = false }) {
  const { theme, items, total, week } = list
  const title = !theme ? 'Theme of the day' : `${pickedDay == null ? "Today's theme" : DAY_NAMES[theme.day]}: ${theme.label}`
  return (
    <section aria-label="Theme of the day">
      <div className={SECTION_HEAD}>
        <SectionTitle icon="calendar" count={total}>{title}</SectionTitle>
        {items.length > 0 && (
          <button type="button" data-theme-start onClick={() => onDial(0)} className="ml-auto min-h-[34px] flex-none rounded-[10px] px-3 text-[13px] font-bold text-white" style={{ background: 'var(--chrome)' }}>
            Start dialing
          </button>
        )}
      </div>
      <div className="grid grid-cols-5 gap-1 border-b border-line px-3 py-2.5">
        {week.map((w) => {
          const active = pickedDay != null ? w.day === pickedDay : w.isToday
          return (
            <button
              key={w.key}
              type="button"
              data-theme-day
              aria-current={w.isToday ? 'date' : undefined}
              aria-pressed={active}
              onClick={() => onPickDay(w.isToday ? null : w.day)}
              className={`min-w-0 rounded-[10px] border px-1 py-1.5 text-center text-[11.5px] leading-tight ${active ? 'border-[color:var(--chrome)] bg-panel2 font-semibold' : 'border-line text-muted'}`}
            >
              <span className="block font-bold">{DAY_NAMES[w.day]}</span>
              {/* Own lines, so a narrow phone cuts the theme name, never the count. */}
              <span className="block truncate">{w.label}</span>
              <span className="num block">{w.count} due</span>
            </button>
          )
        })}
      </div>
      {!theme && <div className="border-b border-line px-4 py-3 text-[13px] text-muted">No theme list on weekends.</div>}
      {theme && items.length === 0 && <div className="border-b border-line px-4 py-3 text-[13px] text-muted">Nobody due on {theme.label} right now.</div>}
      {items.map((it, i) => {
        const r = it.row
        const tel = telHref(r.phone)
        return (
          <div key={it.id} data-theme-row className="border-b border-line px-4 py-2.5">
            <div className="flex items-center gap-3">
              <div role="button" tabIndex={0} onClick={() => onDial(i)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onDial(i)} className="min-w-0 flex-1 cursor-pointer text-left" aria-label={`Dial ${r.name || 'contact'}`}>
                <PersonLink id={r.id} url={r.crm_profile_url} className="block truncate text-[14px] font-semibold">{r.name || '(no name)'}</PersonLink>
                <div className="mt-0.5 text-[12.5px] text-muted">{[it.label, it.hint].filter(Boolean).join(' · ')}</div>
              </div>
              {tel && (
                <a href={tel} aria-label={`Call ${r.name || 'contact'}`} className="grid h-10 w-10 flex-none place-items-center rounded-[10px] text-muted hover:bg-hoverbg">
                  <CallIcon />
                </a>
              )}
            </div>
            {it.kind === 'loan_status' && <AgentLines agents={agents?.get(it.id)} checked={agentsChecked} />}
          </div>
        )
      })}
      {total > items.length && <div className="border-b border-line px-4 py-2 text-[12px] text-dim">{total - items.length} more due, they'll come up next week.</div>}
    </section>
  )
}
