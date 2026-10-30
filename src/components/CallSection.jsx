// The Workbench Calls lane's sections (today's theme, follow-ups overdue, lead
// cadence, More from Up Next): each sits in its own box under a bold header
// with an icon and a count. The lists render the header themselves; CallBox
// is the box, and hides itself when its list renders nothing.
import Icon from './Icon'

export const SECTION_HEAD = 'flex min-h-[46px] items-center gap-2 border-b border-line2 bg-[#EEF1F4] px-4 py-2 text-[15px] font-bold text-[color:var(--text)]'

export function SectionTitle({ icon, iconColor, children, count }) {
  return (
    <>
      {icon && (
        <span className="flex flex-none" style={iconColor ? { color: iconColor } : undefined}>
          <Icon name={icon} size={17} strokeWidth={2} />
        </span>
      )}
      <h3 className="min-w-0 truncate">{children}</h3>
      {count != null && <span className="num flex-none rounded-full border border-line2 bg-panel px-2 py-[1px] text-[12px] font-bold text-muted">{count}</span>}
    </>
  )
}

export function CallBox({ children }) {
  return <div className="overflow-hidden rounded-[12px] border border-line2 bg-panel empty:hidden [&_section>*:last-child]:border-b-0">{children}</div>
}
