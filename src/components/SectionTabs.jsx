// Pages that share one nav link get a tab bar above them: Reports
// (Scoreboard, Analytics) and Settings (Sync status, Settings). Each tab keeps
// its own route, so old links still land on the right tab.
import { NavLink, Outlet } from 'react-router-dom'

export default function SectionTabs({ label, tabs }) {
  return (
    <>
      <nav aria-label={label} className="-mt-3 mb-6 flex gap-1 border-b border-line">
        {tabs.map(([to, text]) => (
          <NavLink
            key={to}
            to={to}
            end
            className={({ isActive }) =>
              `-mb-px flex min-h-[38px] items-center border-b-2 px-3 text-[13.5px] ${
                isActive ? 'border-[color:var(--text)] font-semibold text-[color:var(--text)]' : 'border-transparent text-muted hover:text-[color:var(--text)]'
              }`
            }
          >
            {text}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </>
  )
}
