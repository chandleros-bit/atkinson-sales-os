import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { LogoMark } from '../components/Icon'

export default function Login() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    setError(null)
    const err = await signIn(email, password)
    if (err) {
      setError(err.message)
      setBusy(false)
    } else {
      navigate('/', { replace: true })
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="cc-card w-full max-w-sm p-7">
        <div className="mb-6 flex items-center gap-3">
          <LogoMark size={40} />
          <div>
            <div className="text-[15px] font-semibold">Atkinson Sales OS</div>
            <div className="text-xs text-muted">Sign in to your dashboard</div>
          </div>
        </div>

        <label className="mb-1 block text-xs font-medium text-muted" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mb-4 w-full rounded-[10px] border border-line2 bg-panel2 px-3 py-2.5 text-sm outline-none focus:border-line2"
          autoComplete="email"
        />

        <label className="mb-1 block text-xs font-medium text-muted" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          className="mb-5 w-full rounded-[10px] border border-line2 bg-panel2 px-3 py-2.5 text-sm outline-none"
          autoComplete="current-password"
        />

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        <button
          onClick={submit}
          disabled={busy || !email || !password}
          className="btn-primary w-full rounded-[10px] py-3 text-sm font-semibold disabled:opacity-50"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </div>
    </div>
  )
}
