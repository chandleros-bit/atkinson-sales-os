import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getAccessToken } from './zoho.ts'

// Zoho caps refreshes at about 10 per 10 minutes, so every Zoho function
// shares one cached access token (oauth_tokens, migration 0039) until shortly
// before it expires.

const ENV = { ZOHO_CLIENT_ID: 'cid', ZOHO_CLIENT_SECRET: 'secret', ZOHO_REFRESH_TOKEN: '1000.abc.refresh-XYZ123' }
const NOW = Date.parse('2026-10-20T18:30:00Z')
const iso = (ms) => new Date(ms).toISOString()

// The slice of supabase-js getAccessToken uses: one row in oauth_tokens.
function fakeDb(row = null) {
  const db = {
    row,
    upserts: [],
    from() {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: db.row, error: null }),
        upsert: async (r) => {
          db.upserts.push(r)
          db.row = r
          return { error: null }
        },
      }
      return q
    },
  }
  return db
}

const refreshed = (token = 'fresh-token', expires_in = 3600) =>
  vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ access_token: token, expires_in }) }))

const realFetch = globalThis.fetch
beforeEach(() => {
  globalThis.Deno = { env: { get: (k) => ENV[k] } }
})
afterEach(() => {
  globalThis.fetch = realFetch
  delete globalThis.Deno
})

describe('getAccessToken (shared cache)', () => {
  it('reuses a cached token that has more than 5 minutes left', async () => {
    globalThis.fetch = refreshed()
    const db = fakeDb({ access_token: 'cached', api_host: 'https://www.zohoapis.com', expires_at: iso(NOW + 30 * 60_000), source: 'XYZ123' })
    expect(await getAccessToken({ db, now: NOW })).toEqual({ accessToken: 'cached', apiHost: 'https://www.zohoapis.com' })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('refreshes near expiry and stores the new token for the other functions', async () => {
    globalThis.fetch = refreshed('fresh-token', 3600)
    const db = fakeDb({ access_token: 'old', api_host: 'https://www.zohoapis.com', expires_at: iso(NOW + 4 * 60_000), source: 'XYZ123' })
    expect(await getAccessToken({ db, now: NOW })).toEqual({ accessToken: 'fresh-token', apiHost: 'https://www.zohoapis.com' })
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(db.upserts[0]).toMatchObject({ provider: 'zoho', access_token: 'fresh-token', expires_at: iso(NOW + 3600 * 1000), source: 'XYZ123' })
  })

  it('refreshes when the refresh token has been replaced (re-authorization)', async () => {
    globalThis.fetch = refreshed()
    const db = fakeDb({ access_token: 'from-old-grant', api_host: 'https://www.zohoapis.com', expires_at: iso(NOW + 50 * 60_000), source: 'OLD999' })
    expect((await getAccessToken({ db, now: NOW })).accessToken).toBe('fresh-token')
  })

  it('refreshes when nothing is cached, and works without a db', async () => {
    globalThis.fetch = refreshed()
    const db = fakeDb(null)
    expect((await getAccessToken({ db, now: NOW })).accessToken).toBe('fresh-token')
    expect(db.upserts).toHaveLength(1)
    expect((await getAccessToken()).accessToken).toBe('fresh-token')
  })

  it('surfaces a refresh failure and caches nothing', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: 'Access Denied' }) }))
    const db = fakeDb(null)
    await expect(getAccessToken({ db, now: NOW })).rejects.toThrow('Zoho token refresh -> 400')
    expect(db.upserts).toHaveLength(0)
  })
})
