import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import { useAuth } from '../context/AuthContext'

export default function Layout() {
  const { isDemoMode } = useAuth()

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="min-w-0 flex-1 px-8 py-7">
        {isDemoMode && (
          <div className="mb-5 rounded-[11px] border border-line bg-panel px-4 py-2.5 text-xs text-muted">
            Demo mode — Supabase is not connected yet. Copy .env.example to .env,
            add your project URL and anon key, and restart to enable sign-in.
          </div>
        )}
        <Outlet />
      </main>
    </div>
  )
}
