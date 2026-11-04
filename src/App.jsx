import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { BusinessProvider } from './context/BusinessContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import Overview from './pages/Overview'
import Workbench from './pages/Workbench'
import SyncStatus from './pages/SyncStatus'
import Pipeline from './pages/Pipeline'
import Contacts from './pages/Contacts'
import Calendar from './pages/Calendar'
import Activity from './pages/Activity'
import PriorityLeads from './pages/PriorityLeads'
import Reports from './pages/Reports'
import Analytics from './pages/Analytics'
import Tasks from './pages/Tasks'
import RateLeads from './pages/RateLeads'
import Settings from './pages/Settings'
import Loans from './pages/Loans'
import BookPage from './components/BookPage'
import SectionTabs from './components/SectionTabs'
import { canVisit, homeFor } from './lib/roles'

const REPORT_TABS = [
  ['/reports', 'Scoreboard'],
  ['/analytics', 'Analytics'],
]
const SETTINGS_TABS = [
  ['/sync', 'Sync status'],
  ['/settings', 'Settings'],
]

function Protected({ children }) {
  const { isAuthed, loading, role, roleError, signOut } = useAuth()
  const { pathname } = useLocation()
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted">
        Loading…
      </div>
    )
  }
  if (!isAuthed) return <Navigate to="/login" replace />
  // Signed in but not in user_roles (or the lookup failed): RLS shows nothing anyway.
  if (!role) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted">
        <p className="text-[15px] font-semibold text-[color:var(--text)]">This login has no access to the OS yet.</p>
        {roleError && <p>Couldn't check access: {roleError}</p>}
        <button type="button" onClick={signOut} className="rounded-[10px] border border-line2 px-3 py-1.5 font-semibold">
          Sign out
        </button>
      </div>
    )
  }
  if (!canVisit(role, pathname)) return <Navigate to={homeFor(role)} replace />
  return children
}

export default function App() {
  return (
    <AuthProvider>
      <BusinessProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              element={
                <Protected>
                  <Layout />
                </Protected>
              }
            >
              <Route path="/" element={<Overview />} />
              {/* The Workbench (calls + work); /priority kept so old links work. */}
              <Route path="/priority" element={<Workbench />} />
              <Route path="/workbench" element={<Workbench />} />
              <Route path="/calendar" element={<Calendar />} />
              {/* One nav link each; the pages are tabs. */}
              <Route element={<SectionTabs label="Reports" tabs={REPORT_TABS} />}>
                <Route path="/reports" element={<Reports />} />
                <Route path="/analytics" element={<Analytics />} />
              </Route>
              <Route path="/tasks" element={<Tasks />} />
              <Route path="/rate" element={<RateLeads />} />
              {/* Follows the business filter; All merges both books. */}
              <Route path="/activity" element={<Activity />} />
              <Route path="/pipeline" element={<BookPage page={Pipeline} />} />
              <Route path="/contacts" element={<BookPage page={Contacts} />} />
              {/* Per-book routes: old links and bookmarks keep working. */}
              <Route path="/mpg/pipeline" element={<Pipeline biz="mpg" />} />
              <Route path="/mpg/activity" element={<Activity biz="mpg" />} />
              <Route path="/mpg/contacts" element={<Contacts biz="mpg" />} />
              <Route path="/bayway/pipeline" element={<Pipeline biz="bay" />} />
              <Route path="/bayway/loans" element={<Loans />} />
              <Route path="/bayway/priority-leads" element={<PriorityLeads />} />
              <Route path="/bayway/activity" element={<Activity biz="bay" />} />
              <Route path="/bayway/contacts" element={<Contacts biz="bay" />} />
              <Route element={<SectionTabs label="Settings" tabs={SETTINGS_TABS} />}>
                <Route path="/sync" element={<SyncStatus />} />
                <Route path="/settings" element={<Settings />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </BusinessProvider>
    </AuthProvider>
  )
}
