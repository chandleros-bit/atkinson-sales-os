import { describe, it, expect } from 'vitest'
import { runSyncFunction } from './syncRun'

// A stand-in for the supabase client: only functions.invoke is used.
const clientReturning = (result) => ({
  functions: {
    invoke: async (name) => {
      if (result instanceof Error) throw result
      return typeof result === 'function' ? result(name) : result
    },
  },
})

describe('runSyncFunction', () => {
  it('resolves null on a successful run', async () => {
    const out = await runSyncFunction(clientReturning({ data: { ok: true, upserted: 5 }, error: null }), 'fub-sync')
    expect(out).toBeNull()
  })

  it('invokes the named function', async () => {
    let called
    await runSyncFunction(clientReturning((name) => ((called = name), { data: { ok: true }, error: null })), 'fub-sync')
    expect(called).toBe('fub-sync')
  })

  it('reports a fetch error (CORS block, network) instead of passing silently', async () => {
    // What supabase-js resolves when the browser blocks the request.
    const error = { name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function' }
    const out = await runSyncFunction(clientReturning({ data: null, error }), 'fub-sync')
    expect(out).toBe('fub-sync failed: Failed to send a request to the Edge Function')
  })

  it("prefers the function's own error body on a non-2xx", async () => {
    const error = {
      name: 'FunctionsHttpError',
      message: 'Edge Function returned a non-2xx status code',
      context: new Response(JSON.stringify({ ok: false, error: 'FUB 401 Unauthorized' }), { status: 500 }),
    }
    const out = await runSyncFunction(clientReturning({ data: null, error }), 'fub-sync')
    expect(out).toBe('fub-sync failed: FUB 401 Unauthorized')
  })

  it('falls back to the generic message when the error body is not JSON', async () => {
    const error = {
      name: 'FunctionsHttpError',
      message: 'Edge Function returned a non-2xx status code',
      context: new Response('Internal Server Error', { status: 500 }),
    }
    const out = await runSyncFunction(clientReturning({ data: null, error }), 'fub-sync')
    expect(out).toBe('fub-sync failed: Edge Function returned a non-2xx status code')
  })

  it('reports a 2xx body that says ok: false', async () => {
    const out = await runSyncFunction(clientReturning({ data: { ok: false, error: 'stage upsert: boom' }, error: null }), 'fub-sync')
    expect(out).toBe('fub-sync failed: stage upsert: boom')
  })

  it('reports a thrown invoke', async () => {
    const out = await runSyncFunction(clientReturning(new Error('boom')), 'fub-sync')
    expect(out).toBe('fub-sync failed: boom')
  })
})
