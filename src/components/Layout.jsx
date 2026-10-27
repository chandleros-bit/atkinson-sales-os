import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import Toaster from './Toaster'
import SearchPalette, { openSearch } from './SearchPalette'
import { PersonSheetHost } from './PersonSheet'
import BusinessFilter from './BusinessFilter'
import { useBusiness } from '../context/BusinessContext'
import { useAuth } from '../context/AuthContext'
import { usePriorityQueue } from '../lib/usePriorityQueue'
import { useNow } from '../lib/useNow'
import { lateLeadCount, titleFor } from '../lib/cardHealth'

// Under 640px (phones) the sidebar becomes a slide-in menu behind a top bar,
// and the pages used most get a bottom tab bar, so pages get the full width.
const TITLES = [
  [/^\/$/, 'Overview'],
  [/^\/(priority|workbench)/, 'Workbench'],
  [/^\/calendar/, 'Calendar'],
  [/^\/reports/, 'Reports'],
  [/^\/analytics/, 'Analytics'],
  [/^\/tasks/, 'Tasks'],
  [/^\/activity/, 'Activity'],
  [/^\/mpg\/pipeline/, 'Pipeline'],
  [/^\/mpg\/activity/, 'Activity'],
  [/^\/mpg\/contacts/, 'Contacts'],
  [/^\/bayway\/pipeline/, 'Pipeline'],
  [/^\/bayway\/priority-leads/, 'Priority Leads'],
  [/^\/bayway\/activity/, 'Activity'],
  [/^\/bayway\/contacts/, 'Contacts'],
  [/^\/sync/, 'Sync Status'],
  [/^\/settings/, 'Settings'],
]
export const pageTitle = (path) => TITLES.find(([re]) => re.test(path))?.[1] || 'Atkinson Sales OS'

function MobileBar({ onMenu }) {
  const { pathname } = useLocation()
  return (
    <div className="sticky top-0 z-30 -mx-4 mb-4 flex items-center gap-2 border-b border-line bg-panel2/95 px-4 py-2 backdrop-blur sm:hidden">
      <button
        type="button"
        onClick={onMenu}
        aria-label="Open menu"
        className="grid h-10 w-10 flex-none place-items-center rounded-[10px] border border-line2 text-[17px] text-muted"
      >
        ☰
      </button>
      <div className="min-w-0 flex-1 truncate text-[14px] font-bold" data-page-title>
        {pageTitle(pathname)}
      </div>
      <div className="w-[150px] flex-none">
        <BusinessFilter />
      </div>
      <button
        type="button"
        onClick={openSearch}
        aria-label="Search"
        className="grid h-10 w-10 flex-none place-items-center rounded-[10px] border border-line2 text-[17px] text-muted"
      >
        ⌕
      </button>
    </div>
  )
}

const Icon = ({ d }) => (
  <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    {d.map((x) => (
      <path key={x} d={x} />
    ))}
  </svg>
)
const ICONS = {
  home: ['M3 11l9-7 9 7', 'M5 10v10h14V10'],
  bench: ['M4 6h16', 'M4 12h16', 'M4 18h10'],
  pipeline: ['M4 5h4v14H4z', 'M10 5h4v9h-4z', 'M16 5h4v6h-4z'],
  tasks: ['M9 11l3 3 8-8', 'M20 12v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h11'],
  calendar: ['M4 6h16v14H4z', 'M4 10h16', 'M8 3v4', 'M16 3v4'],
}

// Phone tab bar: the five pages used on the go. Pipeline follows the book
// filter (MPG when MPG is picked, else Bayway).
function BottomNav() {
  const { biz } = useBusiness() || { biz: 'all' }
  const { pathname } = useLocation()
  const items = [
    { to: '/', label: 'Home', icon: 'home', on: pathname === '/' },
    { to: '/workbench', label: 'Workbench', icon: 'bench', on: /^\/(priority|workbench)/.test(pathname) },
    { to: biz === 'mpg' ? '/mpg/pipeline' : '/bayway/pipeline', label: 'Pipeline', icon: 'pipeline', on: /\/pipeline$/.test(pathname) },
    { to: '/tasks', label: 'Tasks', icon: 'tasks', on: pathname.startsWith('/tasks') },
    { to: '/calendar', label: 'Calendar', icon: 'calendar', on: pathname.startsWith('/calendar') },
  ]
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-panel/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden"
    >
      {items.map((it) => (
        <NavLink
          key={it.label}
          to={it.to}
          aria-current={it.on ? 'page' : undefined}
          className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[10.5px] font-semibold ${it.on ? 'text-[color:var(--text)]' : 'text-muted'}`}
        >
          <Icon d={ICONS[it.icon]} />
          {it.label}
        </NavLink>
      ))}
    </nav>
  )
}

export default function Layout() {
  const { isDemoMode } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  // "(1) New lead waiting · Atkinson Sales OS" while a new lead's timer is red.
  // queue rows are v_lead_signals rows: they carry stage, crm_created_at and
  // last_outbound_call_at for both books.
  const { queue, rules } = usePriorityQueue('all')
  const now = useNow(30_000)
  const late = lateLeadCount(queue, rules, now)
  useEffect(() => {
    document.title = titleFor(late)
  }, [late])

  return (
    <div className="flex min-h-screen">
      <div className="hidden sm:flex">
        <Sidebar />
      </div>
      {menuOpen && (
        <div className="fixed inset-0 z-40 flex sm:hidden" onClick={() => setMenuOpen(false)}>
          <div className="h-full" onClick={(e) => e.stopPropagation()}>
            <Sidebar onNavigate={() => setMenuOpen(false)} />
          </div>
          <div className="flex-1 bg-black/40" />
        </div>
      )}
      <main className="min-w-0 flex-1 px-4 pb-[calc(84px+env(safe-area-inset-bottom))] sm:p-[26px]">
        <MobileBar onMenu={() => setMenuOpen(true)} />
        {isDemoMode && (
          <div className="mb-5 rounded-[11px] border border-line bg-panel px-4 py-2.5 text-xs text-muted">
            Demo mode — Supabase is not connected yet. Copy .env.example to .env,
            add your project URL and anon key, and restart to enable sign-in.
          </div>
        )}
        <Outlet />
      </main>
      <BottomNav />
      <Toaster />
      <SearchPalette />
      <PersonSheetHost />
    </div>
  )
}
