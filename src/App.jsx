import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { BusinessProvider } from './context/BusinessContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import Overview from './pages/Overview'
import SyncStatus from './pages/SyncStatus'
import Pipeline from './pages/Pipeline'
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
              <Route
                path="/calendar"
                element={
                  <PagePlaceholder title="Calendar" phase="5">
                    Merged view of both Outlook accounts, events colored by source.
                  </PagePlaceholder>
                }
              />
              <Route
                path="/reports"
                element={
                  <PagePlaceholder title="Reports" phase="6">
                    Per-business trends plus the combined revenue timeline.
                  </PagePlaceholder>
                }
              />
              <Route path="/mpg/pipeline" element={<Pipeline biz="mpg" />} />
              <Route
                path="/mpg/activity"
                element={<PagePlaceholder title="Activity" biz="mpg" phase="6" />}
              />
              <Route
                path="/mpg/contacts"
                element={
                  <PagePlaceholder title="Contacts" biz="mpg" phase="6">
                    Read-only table synced from Zoho CRM.
                  </PagePlaceholder>
                }
              />
              <Route path="/bayway/pipeline" element={<Pipeline biz="bay" />} />
              <Route
                path="/bayway/activity"
                element={<PagePlaceholder title="Activity" biz="bay" phase="6" />}
              />
              <Route
                path="/bayway/contacts"
                element={
                  <PagePlaceholder title="Contacts" biz="bay" phase="6">
                    Read-only table synced from FollowUpBoss.
                  </PagePlaceholder>
                }
              />
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
