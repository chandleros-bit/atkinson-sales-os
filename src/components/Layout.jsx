import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import Toaster from './Toaster'
import SearchPalette, { openSearch } from './SearchPalette'
import { PersonSheetHost } from './PersonSheet'
import BusinessFilter from './BusinessFilter'
import NewMenu from './NewMenu'
import Icon from './Icon'
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
    <div className="sticky top-0 z-30 -mx-4 mb-4 flex items-center gap-2 border-b border-line bg-panel/95 px-4 py-2 backdrop-blur sm:hidden">
      <button
        type="button"
        onClick={onMenu}
        aria-label="Open menu"
        className="grid h-10 w-10 flex-none place-items-center rounded-[10px] border border-line2 text-muted"
      >
        <Icon name="menu" size={19} />
      </button>
      <div className="min-w-0 flex-1 truncate text-[15px] font-semibold" data-page-title>
        {pageTitle(pathname)}
      </div>
      <div className="w-[164px] flex-none">
        <BusinessFilter compact />
      </div>
      <button
        type="button"
        onClick={openSearch}
        aria-label="Search"
        className="grid h-10 w-10 flex-none place-items-center rounded-[10px] border border-line2 text-muted"
      >
        <Icon name="search" size={19} />
      </button>
    </div>
  )
}

// Desktop top bar: the page's name, the business switch and + New.
function TopBar() {
  const { pathname } = useLocation()
  return (
    <div className="mb-7 hidden h-[72px] items-center justify-between gap-4 border-b border-line sm:flex">
      <div className="truncate text-[22px] font-semibold tracking-[-0.4px]" data-page-title>
        {pageTitle(pathname)}
      </div>
      <div className="flex flex-none items-center gap-3">
        <div className="w-[248px]">
          <BusinessFilter />
        </div>
        <NewMenu />
      </div>
    </div>
  )
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
          <Icon name={it.icon} size={20} strokeWidth={1.9} />
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
      <main className="min-w-0 flex-1 px-4 pb-[calc(84px+env(safe-area-inset-bottom))] sm:px-10 sm:pb-12">
        <MobileBar onMenu={() => setMenuOpen(true)} />
        <TopBar />
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
