import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useBusiness } from '../context/BusinessContext'
import { isDemoMode as noDb } from '../lib/supabase'
import { syncHealth } from '../lib/syncHealth'
import { useSyncHealth } from '../lib/useSyncHealth'
import { useNow } from '../lib/useNow'
import { openSearch } from './SearchPalette'
import { SYNC_DOT } from './PageHeader'
import NewMenu from './NewMenu'
import Icon, { LogoMark } from './Icon'
import { usePriorityQueue } from '../lib/usePriorityQueue'
import { urgentCount } from '../lib/priorityQueue'

// Nine links. Pipeline, Contacts and Activity follow the business switch, so
// one link covers both books; each also lights up on its old per-book pages
// (/bayway/pipeline, /mpg/contacts…). Reports holds Analytics and Settings
// holds Sync Status as tabs.
const LINKS = [
  { group: null, items: [
    { to: '/', icon: 'home', label: 'Overview', on: /^\/$/ },
    { to: '/workbench', icon: 'bench', label: 'Workbench', on: /^\/(workbench|priority|bayway\/priority-leads)/, urgent: true },
    { to: '/calendar', icon: 'calendar', label: 'Calendar', on: /^\/calendar/ },
    { to: '/tasks', icon: 'tasks', label: 'Tasks', on: /^\/tasks/ },
  ] },
  { group: 'Books', items: [
    { to: '/pipeline', icon: 'pipeline', label: 'Pipeline', on: /^\/((mpg|bayway)\/)?pipeline/ },
    { to: '/contacts', icon: 'users', label: 'Contacts', on: /^\/((mpg|bayway)\/)?contacts/ },
    { to: '/activity', icon: 'activity', label: 'Activity', on: /^\/((mpg|bayway)\/)?activity/ },
  ] },
  { group: 'Insights', items: [{ to: '/reports', icon: 'reports', label: 'Reports', on: /^\/(reports|analytics)/ }] },
  { group: 'System', items: [{ to: '/sync', icon: 'settings', label: 'Settings', on: /^\/(sync|settings)/, sync: true }] },
]

// Green / amber / red: the last sync, at a glance (Sync Status has the detail).
function SyncMark() {
  const latest = useSyncHealth()
  const now = useNow(60_000)
  if (noDb || !latest) return null
  const h = syncHealth(latest, now)
  return <span data-sync-state={h.state} title={h.text} className="h-[7px] w-[7px] flex-none rounded-full" style={{ background: SYNC_DOT[h.state] }} />
}

function Item({ to, icon, on, children, badge, onNavigate, sync }) {
  return (
    <Link
      to={to}
      onClick={onNavigate}
      aria-current={on ? 'page' : undefined}
      className={`flex min-h-[32px] items-center gap-2.5 rounded-[9px] px-2.5 text-[13px] ${
        on
          ? 'bg-[color:var(--chrome-soft)] font-semibold text-[color:var(--text)]'
          : 'font-medium text-muted hover:bg-hoverbg hover:text-[color:var(--text)]'
      }`}
    >
      <Icon name={icon} size={16} strokeWidth={1.8} />
      <span className="flex-1 truncate">{children}</span>
      {badge != null && (
        <span className="rounded-full bg-[color:var(--text)] px-1.5 text-[10.5px] font-semibold leading-[17px] text-white">{badge}</span>
      )}
      {sync && <SyncMark />}
    </Link>
  )
}

function GroupLabel({ children }) {
  return <div className="px-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-[.5px] text-dim">{children}</div>
}

export default function Sidebar({ onNavigate }) {
  const { signOut, isDemoMode } = useAuth()
  const { biz } = useBusiness()
  const { pathname } = useLocation()
  // "Act now" count (buckets 1-3) for the current filter; same data as /priority.
  const { queue } = usePriorityQueue(biz)
  const urgent = urgentCount(queue)

  return (
    <aside className="flex h-full w-[216px] flex-none flex-col gap-3 overflow-y-auto border-r border-line bg-panel2 px-3 py-4">
      <div className="flex items-center gap-2 px-1">
        <LogoMark size={26} />
        <h1 className="truncate text-[15px] font-bold tracking-[-0.3px]">
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
        className="flex h-[34px] flex-none items-center gap-2 rounded-[9px] border border-line2 bg-panel px-2.5 text-left text-[13px] text-dim"
      >
        <Icon name="search" size={16} />
        <span className="flex-1">Search</span>
        <span className="rounded-[5px] border border-line2 px-1.5 text-[10.5px]">Ctrl K</span>
      </button>

      {/* Phones: + New lives here (the desktop top bar has it otherwise). */}
      {onNavigate && <NewMenu onBeforePick={onNavigate} />}

      <nav aria-label="Main" className="flex flex-col gap-3">
        {LINKS.map(({ group, items }) => (
          <div key={group || 'main'} className="flex flex-col gap-px">
            {group && <GroupLabel>{group}</GroupLabel>}
            {items.map((it) => (
              <Item
                key={it.to}
                onNavigate={onNavigate}
                to={it.to}
                icon={it.icon}
                on={it.on.test(pathname)}
                badge={it.urgent ? urgent || null : null}
                sync={it.sync}
              >
                {it.label}
              </Item>
            ))}
          </div>
        ))}
      </nav>

      <div className="mt-auto flex items-center gap-2 border-t border-line px-1 pt-2.5">
        <div className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full bg-[#E4E7EC] text-[11.5px] font-semibold text-[#344054]">
          CA
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold">Chandler Atkinson</div>
          <div className="flex items-center gap-1 text-[11.5px] text-dim">
            <span className="truncate">Super Admin</span>
            {!isDemoMode && (
              <button onClick={signOut} className="flex-none rounded px-1 text-[11.5px] text-dim hover:text-[color:var(--text)]">
                Sign out
              </button>
            )}
          </div>
        </div>
      </div>
    </aside>
  )
}
