// "Run sync now" from the browser. supabase.functions.invoke() never throws on
// a failed call: it resolves { data, error }, so an unchecked call (or one only
// wrapped in try/catch) passes a CORS block, a network error or a 500 silently.
// Resolves to null on success, or a message to show.
export async function runSyncFunction(client, name) {
  try {
    const { data, error } = await client.functions.invoke(name)
    if (error) {
      // Non-2xx: the sync functions answer { ok: false, error }; prefer that
      // over supabase-js's generic "Edge Function returned a non-2xx status code".
      let message = error.message
      try {
        const body = await error.context?.json?.()
        if (body?.error) message = body.error
      } catch {
        // keep error.message
      }
      return `${name} failed: ${message}`
    }
    if (data && data.ok === false) return `${name} failed: ${data.error || 'unknown error'}`
    return null
  } catch (e) {
    return `${name} failed: ${String(e?.message || e)}`
  }
}
