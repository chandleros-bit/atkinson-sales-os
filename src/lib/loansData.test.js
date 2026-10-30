import { describe, it, expect, vi, beforeEach } from 'vitest'

// Per-table responses ({ data, error }) and every write, so the tests never
// reach the real Supabase client.
const responses = {}
const writes = []
const selects = {}
vi.mock('./supabase', () => ({
  supabase: {
    from: (table) => {
      const q = {}
      for (const m of ['eq', 'order', 'limit', 'range', 'maybeSingle']) q[m] = () => q
      q.select = (cols) => {
        selects[table] = cols
        return q
      }
      for (const op of ['insert', 'upsert']) {
        q[op] = (body) => {
          writes.push({ table, op, body })
          return q
        }
      }
      q.then = (resolve) => resolve(responses[table] || { data: null, error: null })
      return q
    },
  },
}))

const { isMissingTable, fetchLoanBundle, saveImport } = await import('./loansData')
const { DEFAULT_RATES } = await import('./loans')

beforeEach(() => {
  for (const k of Object.keys(responses)) delete responses[k]
  for (const k of Object.keys(selects)) delete selects[k]
  writes.length = 0
})

describe('isMissingTable', () => {
  it('spots a missing relation by code or message', () => {
    expect(isMissingTable({ code: '42P01', message: 'x' })).toBe(true)
    expect(isMissingTable({ code: 'PGRST205', message: 'x' })).toBe(true)
    expect(isMissingTable({ message: 'relation "public.loans" does not exist' })).toBe(true)
    expect(isMissingTable(new Error("Could not find the table 'public.loans' in the schema cache"))).toBe(true)
  })

  it('leaves every other error alone', () => {
    expect(isMissingTable(null)).toBe(false)
    expect(isMissingTable(undefined)).toBe(false)
    expect(isMissingTable({ code: '42501', message: 'permission denied for table loans' })).toBe(false)
    expect(isMissingTable({ code: '42703', message: 'column loans.foo does not exist' })).toBe(false)
    expect(isMissingTable(new Error('Failed to fetch'))).toBe(false)
  })
})

describe('fetchLoanBundle', () => {
  it('reads as "nothing imported yet" before the loans migration', async () => {
    responses.loans = { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.loans' in the schema cache" } }
    expect(await fetchLoanBundle()).toEqual({ data: { loans: [], rates: DEFAULT_RATES, lastImport: null }, error: null })
  })

  it('still returns any other error', async () => {
    const error = { code: '42501', message: 'permission denied for table loans' }
    responses.loans = { data: null, error }
    const res = await fetchLoanBundle()
    expect(res.data).toBeNull()
    expect(res.error.message).toBe('permission denied for table loans')
  })

  it('selects explicit columns, never the raw row', async () => {
    responses.loans = { data: [{ id: 'a', amount: 1 }], error: null }
    const res = await fetchLoanBundle()
    expect(res.data.loans).toEqual([{ id: 'a', amount: 1 }])
    expect(selects.loans).not.toBe('*')
    expect(selects.loans.split(',').map((c) => c.trim())).not.toContain('raw')
    expect(selects.loans).toContain('arive_loan_id')
    expect(selects.loans).toContain('funded_on')
  })
})

describe('saveImport', () => {
  const preview = { loans: [{ arive_loan_id: '1', raw: {} }], counts: { new: 1, updated: 0, unchanged: 0, scenario: 0, unmatched: 0, missing: 0 } }

  it('saves and logs cleanly', async () => {
    expect(await saveImport(preview)).toEqual({ error: null, warning: null })
    expect(writes.map((w) => w.table)).toEqual(['loans', 'sync_log'])
  })

  it('warns, not fails, when only the log insert fails', async () => {
    responses.sync_log = { data: null, error: { message: 'new row violates row-level security policy' } }
    expect(await saveImport(preview)).toEqual({
      error: null,
      warning: 'Loans saved, but the import log failed: new row violates row-level security policy',
    })
  })

  it('returns the save error when the loans upsert fails', async () => {
    const error = { message: 'boom' }
    responses.loans = { data: null, error }
    const res = await saveImport(preview)
    expect(res.error).toBe(error)
  })
})
