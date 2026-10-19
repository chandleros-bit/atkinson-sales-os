import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { withRetry429 } from './retry.ts'
import { fubSend } from './fub.ts'
import { zohoSend, zohoRecordError } from './zoho.ts'

const response = (status, body = '', headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => headers[k] ?? null },
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
})

describe('withRetry429', () => {
  it('passes a non-429 response straight through', async () => {
    const doFetch = vi.fn(async () => response(201, 'ok'))
    const sleep = vi.fn()
    const res = await withRetry429(doFetch, { sleep })
    expect(res.status).toBe(201)
    expect(doFetch).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('retries once after Retry-After, capped at 5 seconds', async () => {
    const doFetch = vi.fn()
      .mockResolvedValueOnce(response(429, '', { 'Retry-After': '30' }))
      .mockResolvedValueOnce(response(200, 'ok'))
    const sleep = vi.fn(async () => {})
    const res = await withRetry429(doFetch, { sleep })
    expect(res.status).toBe(200)
    expect(sleep).toHaveBeenCalledWith(5000)
  })

  it('waits Retry-After when it is short, and 1s when it is missing', async () => {
    const sleep = vi.fn(async () => {})
    await withRetry429(
      vi.fn().mockResolvedValueOnce(response(429, '', { 'Retry-After': '2' })).mockResolvedValueOnce(response(200)),
      { sleep },
    )
    await withRetry429(vi.fn().mockResolvedValueOnce(response(429)).mockResolvedValueOnce(response(200)), { sleep })
    expect(sleep.mock.calls).toEqual([[2000], [1000]])
  })

  it('returns the second 429 for the caller to fail', async () => {
    const doFetch = vi.fn(async () => response(429))
    const res = await withRetry429(doFetch, { sleep: async () => {} })
    expect(res.status).toBe(429)
    expect(doFetch).toHaveBeenCalledTimes(2)
  })
})

describe('fubSend', () => {
  const realFetch = globalThis.fetch
  beforeEach(() => {
    globalThis.Deno = { env: { get: (k) => ({ FUB_API_KEY: 'key123' })[k] } }
  })
  afterEach(() => {
    globalThis.fetch = realFetch
    delete globalThis.Deno
  })

  it('POSTs JSON with Basic auth and the X-System header', async () => {
    globalThis.fetch = vi.fn(async () => response(201, { id: 77 }))
    const out = await fubSend('POST', '/calls', { personId: 5 })
    expect(out).toEqual({ id: 77 })
    const [url, init] = globalThis.fetch.mock.calls[0]
    expect(url).toBe('https://api.followupboss.com/v1/calls')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Basic ' + btoa('key123:'))
    expect(init.headers['X-System']).toBe('AtkinsonSalesOS')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({ personId: 5 })
  })

  it('throws with the status and the start of the body', async () => {
    globalThis.fetch = vi.fn(async () => response(422, 'phone is required'))
    await expect(fubSend('POST', '/calls', {})).rejects.toThrow('FUB POST /calls -> 422: phone is required')
  })
})

describe('zohoRecordError', () => {
  it('pulls a record-level error out of a 200 body', () => {
    expect(zohoRecordError({ data: [{ code: 'MANDATORY_NOT_FOUND', status: 'error', message: 'required field not found', details: { api_name: 'Call_Duration' } }] }))
      .toBe('MANDATORY_NOT_FOUND: required field not found {"api_name":"Call_Duration"}')
  })
  it('is null for a success or an empty body', () => {
    expect(zohoRecordError({ data: [{ code: 'SUCCESS', status: 'success', details: { id: '1' } }] })).toBe(null)
    expect(zohoRecordError({})).toBe(null)
    expect(zohoRecordError(null)).toBe(null)
  })
})

describe('zohoSend', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('sends the oauth header and returns the body', async () => {
    const body = { data: [{ code: 'SUCCESS', status: 'success', details: { id: '9001' } }] }
    globalThis.fetch = vi.fn(async () => response(201, body))
    expect(await zohoSend('https://api.example', 'tok', 'POST', 'Calls', { data: [{}] })).toEqual(body)
    const [url, init] = globalThis.fetch.mock.calls[0]
    expect(url).toBe('https://api.example/crm/v2/Calls')
    expect(init.headers.Authorization).toBe('Zoho-oauthtoken tok')
  })

  it('throws on a record-level error even with HTTP 200', async () => {
    globalThis.fetch = vi.fn(async () => response(200, { data: [{ code: 'INVALID_DATA', status: 'error', message: 'invalid data' }] }))
    await expect(zohoSend('https://api.example', 'tok', 'PUT', 'Tasks', { data: [{}] }))
      .rejects.toThrow('Zoho PUT Tasks -> INVALID_DATA: invalid data')
  })

  it('throws on an HTTP failure', async () => {
    globalThis.fetch = vi.fn(async () => response(401, 'OAUTH_SCOPE_MISMATCH'))
    await expect(zohoSend('https://api.example', 'tok', 'POST', 'Calls', {}))
      .rejects.toThrow('Zoho POST Calls -> 401: OAUTH_SCOPE_MISMATCH')
  })
})
