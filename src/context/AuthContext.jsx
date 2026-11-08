import { createContext, useContext, useEffect, useState } from 'react'
import { supabase, isDemoMode } from '../lib/supabase'
import { friendlyError } from '../lib/friendlyError'

const AuthContext = createContext(null)
const NO_ROLE = { role: null, books: [], name: null, error: null }

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(!isDemoMode)
  // The signed-in user's user_roles row (owner or assistant). Demo mode is the owner.
  const [access, setAccess] = useState(isDemoMode ? { role: 'owner', books: ['bay', 'mpg'], name: null, error: null } : NO_ROLE)
  const [roleLoading, setRoleLoading] = useState(!isDemoMode)

  useEffect(() => {
    if (isDemoMode) return
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const uid = session?.user?.id || null
  useEffect(() => {
    if (isDemoMode) return undefined
    if (!uid) {
      setAccess(NO_ROLE)
      setRoleLoading(false)
      return undefined
    }
    let live = true
    setRoleLoading(true)
    Promise.resolve(supabase.from('user_roles').select('role, books, name').eq('user_id', uid).maybeSingle()).then(
      ({ data, error }) => {
        if (!live) return
        setAccess({ role: data?.role ?? null, books: data?.books ?? [], name: data?.name ?? null, error: error?.message ?? null })
        setRoleLoading(false)
      },
      (e) => {
        if (!live) return
        setAccess({ ...NO_ROLE, error: friendlyError(e) })
        setRoleLoading(false)
      },
    )
    return () => {
      live = false
    }
  }, [uid])

  const signIn = async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return error
  }

  const signOut = async () => {
    if (!isDemoMode) await supabase.auth.signOut()
  }

  const value = {
    session,
    loading: loading || (Boolean(session) && roleLoading),
    isDemoMode,
    isAuthed: isDemoMode || Boolean(session),
    role: access.role,
    books: access.books,
    userName: access.name,
    roleError: access.error,
    signIn,
    signOut,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
