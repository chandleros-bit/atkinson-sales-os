import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase, isDemoMode } from '../lib/supabase'
import { readAuthLink, passwordProblem } from '../lib/authLink'
import { LogoMark } from '../components/Icon'

// Invite and password-reset landing page (see src/lib/authLink.js).
// 1. confirm: press the button to spend the one-time token (verifyOtp).
// 2. password: the now signed-in login sets its password (updateUser).
const USED_UP = 'This link has expired or was already used.'

function Shell({ subtitle, children }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="cc-card w-full max-w-sm p-7">
        <div className="mb-6 flex items-center gap-3">
          <LogoMark size={40} />
          <div>
            <div className="text-[15px] font-semibold">Atkinson Sales OS</div>
            <div className="text-xs text-muted">{subtitle}</div>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}

function Problem({ children }) {
  return <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{children}</div>
}

const INPUT = 'mb-4 w-full rounded-[10px] border border-line2 bg-panel2 px-3 py-2.5 text-sm outline-none'

export default function AcceptInvite() {
  const { session, loading } = useAuth()
  const { search, hash } = useLocation()
  const navigate = useNavigate()
  const [link] = useState(() => readAuthLink(search, hash))
  const [verified, setVerified] = useState(false)
  const [error, setError] = useState(link.error ? USED_UP : null)
  const [busy, setBusy] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')

  const isReset = link.type === 'recovery'

  if (isDemoMode) return <Shell subtitle="Demo mode">Invites need the live database.</Shell>
  if (loading) return <Shell subtitle="Loading…" />

  const accept = async () => {
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.auth.verifyOtp({ token_hash: link.tokenHash, type: link.type })
    setBusy(false)
    if (err) setError(USED_UP)
    else setVerified(true)
  }

  const save = async () => {
    const problem = passwordProblem(password, confirm)
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (err) setError(err.message)
    else navigate('/', { replace: true })
  }

  // Signed in (just verified, or already had a session): set the password.
  if (verified || (session && !link.tokenHash)) {
    return (
      <Shell subtitle={isReset ? 'Choose a new password' : 'Welcome. Choose your password'}>
        <label className="mb-1 block text-xs font-medium text-muted" htmlFor="new-password">
          New password
        </label>
        <input
          id="new-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={INPUT}
          autoComplete="new-password"
        />
        <label className="mb-1 block text-xs font-medium text-muted" htmlFor="confirm-password">
          Type it again
        </label>
        <input
          id="confirm-password"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          className={INPUT}
          autoComplete="new-password"
        />
        {error && <Problem>{error}</Problem>}
        <button onClick={save} disabled={busy} className="btn-primary w-full rounded-[10px] py-3 text-sm font-semibold disabled:opacity-50">
          {busy ? 'Saving…' : 'Save password'}
        </button>
      </Shell>
    )
  }

  // A usable link that has not been spent yet.
  if (link.tokenHash && !error) {
    return (
      <Shell subtitle={isReset ? 'Reset your password' : 'You have been invited'}>
        <p className="mb-5 text-sm text-muted">
          {isReset ? 'Press the button to choose a new password.' : 'Press the button to accept and choose your password.'}
        </p>
        <button onClick={accept} disabled={busy} className="btn-primary w-full rounded-[10px] py-3 text-sm font-semibold disabled:opacity-50">
          {busy ? 'Checking…' : isReset ? 'Continue to reset password' : 'Accept invite'}
        </button>
      </Shell>
    )
  }

  // Used up, expired or no link at all.
  return (
    <Shell subtitle={isReset ? 'Reset your password' : 'Invite'}>
      <Problem>{error || USED_UP}</Problem>
      <p className="mb-5 text-sm text-muted">
        {isReset
          ? 'Request a new reset link from the sign-in page.'
          : 'Ask Chandler to send a new invite, or use Forgot password on the sign-in page if you already accepted one.'}
      </p>
      <Link to="/login" className="btn-primary block w-full rounded-[10px] py-3 text-center text-sm font-semibold">
        Go to sign in
      </Link>
    </Shell>
  )
}
