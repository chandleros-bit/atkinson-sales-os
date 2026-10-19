import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import Toaster from './Toaster'
import BusinessFilter from './BusinessFilter'
import { useAuth } from '../context/AuthContext'

// Under 640px (phones) the sidebar becomes a slide-in menu behind a top bar,
// so pages get the full width. Up Next is the first page built phone-first.
function MobileBar({ onMenu }) {
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
      <NavLink
        to="/priority"
        className={({ isActive }) =>
          `flex h-10 flex-none items-center rounded-[10px] px-3 text-[13px] font-semibold ${isActive ? 'grad-dual-soft' : 'text-muted'}`
        }
      >
        Up Next
      </NavLink>
      <div className="min-w-0 flex-1">
        <BusinessFilter />
      </div>
    </div>
  )
}

export default function Layout() {
  const { isDemoMode } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)

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
      <main className="min-w-0 flex-1 px-4 pb-6 sm:p-[26px]">
        <MobileBar onMenu={() => setMenuOpen(true)} />
        {isDemoMode && (
          <div className="mb-5 rounded-[11px] border border-line bg-panel px-4 py-2.5 text-xs text-muted">
            Demo mode — Supabase is not connected yet. Copy .env.example to .env,
            add your project URL and anon key, and restart to enable sign-in.
          </div>
        )}
        <Outlet />
      </main>
      <Toaster />
    </div>
  )
}
