import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useBusiness } from '../context/BusinessContext'
import { openSearch } from './SearchPalette'
import NewMenu from './NewMenu'
import Icon, { LogoMark } from './Icon'
import { usePriorityQueue } from '../lib/usePriorityQueue'
import { urgentCount } from '../lib/priorityQueue'

function Item({ to, icon, children, badge, onNavigate, end }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      className={({ isActive }) =>
        `flex min-h-[40px] items-center gap-3 rounded-[10px] px-2.5 text-[14.5px] ${
          isActive
            ? 'bg-[color:var(--chrome-soft)] font-semibold text-[color:var(--text)]'
            : 'font-medium text-muted hover:bg-hoverbg hover:text-[color:var(--text)]'
        }`
      }
    >
      <Icon name={icon} size={19} strokeWidth={1.7} />
      <span className="flex-1 truncate">{children}</span>
      {badge != null && (
        <span className="rounded-full bg-[color:var(--text)] px-1.5 py-px text-[11px] font-semibold text-white">{badge}</span>
      )}
    </NavLink>
  )
}

function GroupLabel({ children, color }) {
  return (
    <div className="px-2.5 pb-1.5 text-[12px] font-medium" style={{ color: color || 'var(--dim)' }}>
      {children}
    </div>
  )
}

export default function Sidebar({ onNavigate }) {
  const { signOut, isDemoMode } = useAuth()
  const { biz } = useBusiness()
  // "Act now" count (buckets 1-3) for the current filter; same data as /priority.
  const { queue } = usePriorityQueue(biz)
  const urgent = urgentCount(queue)

  return (
    <aside className="flex h-full w-[248px] flex-none flex-col gap-4 overflow-y-auto border-r border-line bg-panel2 px-4 py-5">
      <div className="flex items-center gap-2.5 px-1">
        <LogoMark />
        <h1 className="truncate text-[16.5px] font-bold tracking-[-0.3px]">
          Atkinson <span className="font-normal text-muted">Sales OS</span>
        </h1>
      </div>

      {/* Looks like a search field; opens the search palette. */}
      <button
        type="button"
        onClick={() => {
          onNavigate?.()
          openSearch()
        }}
        className="flex h-[42px] items-center gap-2.5 rounded-[10px] border border-line2 bg-panel px-3 text-left text-[14px] text-dim"
      >
        <Icon name="search" />
        <span className="flex-1">Search</span>
        <span className="rounded-[5px] border border-line2 px-1.5 text-[11px]">Ctrl K</span>
      </button>

      {/* Phones: + New lives here (the desktop top bar has it otherwise). */}
      {onNavigate && <NewMenu onBeforePick={onNavigate} />}

      <nav aria-label="Main" className="flex flex-col gap-4">
        <div className="flex flex-col gap-0.5">
          <GroupLabel>Main Menu</GroupLabel>
          <Item onNavigate={onNavigate} to="/" end icon="home">Overview</Item>
          <Item onNavigate={onNavigate} to="/workbench" icon="bench" badge={urgent || null}>Workbench</Item>
          <Item onNavigate={onNavigate} to="/calendar" icon="calendar">Calendar</Item>
          <Item onNavigate={onNavigate} to="/tasks" icon="tasks">Tasks</Item>
          <Item onNavigate={onNavigate} to="/activity" icon="activity">Activity</Item>
        </div>
        <div className="flex flex-col gap-0.5">
          <GroupLabel>Report</GroupLabel>
          <Item onNavigate={onNavigate} to="/reports" icon="reports">Reports</Item>
          <Item onNavigate={onNavigate} to="/analytics" icon="analytics">Analytics</Item>
        </div>
        <div className="flex flex-col gap-0.5">
          <GroupLabel color="var(--mpg-ink)">MPG</GroupLabel>
          <Item onNavigate={onNavigate} to="/mpg/pipeline" icon="pipeline">Pipeline</Item>
          <Item onNavigate={onNavigate} to="/mpg/activity" icon="activity">Activity</Item>
          <Item onNavigate={onNavigate} to="/mpg/contacts" icon="users">Contacts · Zoho</Item>
        </div>
        <div className="flex flex-col gap-0.5">
          <GroupLabel color="var(--bay-ink)">Bayway</GroupLabel>
          <Item onNavigate={onNavigate} to="/bayway/pipeline" icon="pipeline">Pipeline</Item>
          <Item onNavigate={onNavigate} to="/bayway/priority-leads" icon="star">Priority Leads</Item>
          <Item onNavigate={onNavigate} to="/bayway/activity" icon="activity">Activity</Item>
          <Item onNavigate={onNavigate} to="/bayway/contacts" icon="users">Contacts · FUB</Item>
        </div>
        <div className="flex flex-col gap-0.5">
          <GroupLabel>Settings</GroupLabel>
          <Item onNavigate={onNavigate} to="/sync" icon="sync">Sync Status</Item>
          <Item onNavigate={onNavigate} to="/settings" icon="settings">Settings</Item>
        </div>
      </nav>

      <div className="mt-auto flex items-center gap-2.5 border-t border-line px-1 pt-3">
        <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-[#E4E7EC] text-[12.5px] font-semibold text-[#344054]">
          CA
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold">Chandler Atkinson</div>
          <div className="flex items-center gap-1.5 text-[12px] text-dim">
            <span className="truncate">Super Admin</span>
            {!isDemoMode && (
              <button onClick={signOut} className="flex-none rounded px-1 text-[12px] text-dim hover:text-[color:var(--text)]">
                Sign out
              </button>
            )}
          </div>
        </div>
      </div>
    </aside>
  )
}
