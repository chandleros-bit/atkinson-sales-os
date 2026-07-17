import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { BusinessProvider } from './context/BusinessContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import Overview from './pages/Overview'
import SyncStatus from './pages/SyncStatus'
import Pipeline from './pages/Pipeline'
import Contacts from './pages/Contacts'
import Calendar from './pages/Calendar'
import Activity from './pages/Activity'
import PriorityLeads from './pages/PriorityLeads'
import Reports from './pages/Reports'
import PagePlaceholder from './components/PagePlaceholder'

function Protected({ children }) {
  const { isAuthed, loading } = useAuth()
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted">
        Loading…
      </div>
    )
  }
  return isAuthed ? children : <Navigate to="/login" replace />
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
              <Route path="/calendar" element={<Calendar />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/mpg/pipeline" element={<Pipeline biz="mpg" />} />
              <Route
                path="/mpg/activity"
                element={<PagePlaceholder title="Activity" biz="mpg" phase="6" />}
              />
              <Route path="/mpg/contacts" element={<Contacts biz="mpg" />} />
              <Route path="/bayway/pipeline" element={<Pipeline biz="bay" />} />
              <Route path="/bayway/priority-leads" element={<PriorityLeads />} />
              <Route path="/bayway/activity" element={<Activity biz="bay" />} />
              <Route path="/bayway/contacts" element={<Contacts biz="bay" />} />
              <Route path="/sync" element={<SyncStatus />} />
              <Route
                path="/settings"
                element={
                  <PagePlaceholder title="Settings" phase="2">
                    Connected accounts, stage mapping, and metric targets.
                  </PagePlaceholder>
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </BusinessProvider>
    </AuthProvider>
  )
}
