import { describe, it, expect, vi } from 'vitest'
import { CORS, withCors } from './cors.ts'

const url = 'https://example.supabase.co/functions/v1/fub-sync'

function expectCors(res) {
  for (const [k, v] of Object.entries(CORS)) expect(res.headers.get(k)).toBe(v)
}

describe('withCors', () => {
  it('answers the preflight without running the handler', async () => {
    const handler = vi.fn()
    const res = await withCors(handler)(
      new Request(url, {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:5173',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization, x-client-info, apikey, content-type',
        },
      }),
    )
    expect(handler).not.toHaveBeenCalled()
    expect(res.status).toBe(200)
    expectCors(res)
  })

  it('allows every header supabase.functions.invoke sends', () => {
    const allowed = CORS['Access-Control-Allow-Headers'].split(',').map((h) => h.trim())
    for (const h of ['authorization', 'x-client-info', 'apikey', 'content-type']) {
      expect(allowed).toContain(h)
    }
  })

  it('adds CORS to a success response and keeps status, body and headers', async () => {
    const res = await withCors(
      async () =>
        new Response(JSON.stringify({ ok: true, upserted: 3 }), {
          headers: { 'content-type': 'application/json' },
        }),
    )(new Request(url, { method: 'POST' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/json')
    expect(await res.json()).toEqual({ ok: true, upserted: 3 })
    expectCors(res)
  })

  it('adds CORS to an error response so the browser can read the message', async () => {
    const res = await withCors(
      async () =>
        new Response(JSON.stringify({ ok: false, error: 'FUB 401' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        }),
    )(new Request(url, { method: 'POST' }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ ok: false, error: 'FUB 401' })
    expectCors(res)
  })

  it('turns a thrown handler error into a 500 with CORS', async () => {
    const res = await withCors(async () => {
      throw new Error('SUPABASE_URL missing')
    })(new Request(url, { method: 'POST' }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ ok: false, error: 'SUPABASE_URL missing' })
    expectCors(res)
  })
})
