import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Demo mode: if env vars are not set, the app runs without auth so the
// shell can be previewed before the Supabase project is connected.
export const isDemoMode = !url || !anonKey

export const supabase = isDemoMode ? null : createClient(url, anonKey)
