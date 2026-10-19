import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { fubAdapter, zohoAdapter } from './crm.ts'

const response = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  text: async () => JSON.stringify(body),
  json: async () => body,
})

const realFetch = globalThis.fetch
const ENV = {
  FUB_API_KEY: 'k', FUB_USER_ID: '12',
  ZOHO_CLIENT_ID: 'a', ZOHO_CLIENT_SECRET: 'b', ZOHO_REFRESH_TOKEN: 'c',
}
const env = (extra = {}) => (k) => ({ ...ENV, ...extra })[k]

beforeEach(() => {
  globalThis.Deno = { env: { get: (k) => ENV[k] } }
})
afterEach(() => {
  globalThis.fetch = realFetch
  delete globalThis.Deno
})

describe('fubAdapter', () => {
  it('logs a call and returns FUB\'s id', async () => {
    globalThis.fetch = vi.fn(async () => response(201, { id: 48213 }))
    const out = await fubAdapter(env()).send.logCall({ externalId: '4821', phone: '5', outcome: 'Busy', durationMin: 1 })
    expect(out).toEqual({ id: 48213 })
    const [url, init] = globalThis.fetch.mock.calls[0]
    expect(url).toBe('https://api.followupboss.com/v1/calls')
    expect(JSON.parse(init.body)).toMatchObject({ personId: 4821, isIncoming: false, duration: 60 })
  })

  it('pushes by PUT dueDate by default', async () => {
    globalThis.fetch = vi.fn(async () => response(200, {}))
    expect(await fubAdapter(env()).send.pushTask({ externalId: '9001', dueDate: '2026-10-21' })).toEqual({ id: '9001' })
    const [url, init] = globalThis.fetch.mock.calls[0]
    expect([String(url), init.method, JSON.parse(init.body)]).toEqual(['https://api.followupboss.com/v1/tasks/9001', 'PUT', { dueDate: '2026-10-21' }])
  })

  it('reschedules by complete + recreate when FUB_PUSH_MODE says so', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(response(200, {}))
      .mockResolvedValueOnce(response(201, { id: 9300 }))
    const out = await fubAdapter(env({ FUB_PUSH_MODE: 'complete_and_recreate' })).send.pushTask({
      externalId: '9001', dueDate: '2026-10-21', contactExternalId: '4821', title: 'Call Jo', type: 'Weird type',
    })
    expect(out).toEqual({ id: 9300, also: ['9001'], rescheduled: true })
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toEqual({ isCompleted: true })
    expect(JSON.parse(globalThis.fetch.mock.calls[1][1].body)).toMatchObject({ personId: 4821, assignedUserId: 12, type: 'Follow Up', dueDate: '2026-10-21' })
  })
})

describe('zohoAdapter', () => {
  const token = response(200, { access_token: 'tok' })

  it('fetches one access token for several calls', async () => {
    globalThis.fetch = vi.fn(async (url) =>
      String(url).includes('/oauth/') ? token : response(201, { data: [{ status: 'success', details: { id: 'Z1' } }] }),
    )
    const z = zohoAdapter(env())
    await z.send.createTask({ externalId: 'L5', title: 'T', dueDate: '2026-10-20' })
    await z.send.completeTask({ externalId: 'Z1' })
    expect(globalThis.fetch.mock.calls.filter(([u]) => String(u).includes('/oauth/'))).toHaveLength(1)
  })

  it('builds the note mirror from what it sent when Notes can\'t be read', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes('/oauth/')) return token
      return response(400, { code: 'NOT_SUPPORTED' })
    })
    const rec = await zohoAdapter(env()).read.note('N1', { externalId: 'L5', body: 'Sent rates' })
    expect(rec).toMatchObject({ id: 'N1', Note_Content: 'Sent rates', Parent_Id: { id: 'L5' }, $se_module: 'Leads' })
  })
})

describe('summarizeSmartLists', () => {
  it('counts each list and tallies stages and tags without names', async () => {
    const { summarizeSmartLists } = await import('./crm.ts')
    const get = async (path, params) => {
      if (path === '/smartLists') return { smartlists: [{ id: 11, name: '01 - New Leads - Untouched', filters: { stage: 'Lead' } }] }
      if (params.smartListId == null) return { _metadata: { total: 1218 }, people: [] }
      return {
        _metadata: { total: 3 },
        people: [
          { id: 1, name: 'A', stage: 'Lead', tags: ['HOT', 'Stage: Attempted'], assignedUserId: 6 },
          { id: 2, name: 'B', stage: 'Lead', tags: ['HOT'], assignedUserId: 2 },
          { id: 3, name: 'C', stage: 'Nurture', tags: [], assignedUserId: 6 },
        ],
      }
    }
    const out = await summarizeSmartLists(get, '6')
    expect(out.all_people_total).toBe(1218)
    expect(out.lists[0]).toEqual({
      id: 11, name: '01 - New Leads - Untouched', total: 3, sampled: 3, mine_in_sample: 2,
      stages: { Lead: 2, Nurture: 1 }, tags: { HOT: 2, 'Stage: Attempted': 1 },
      definition_keys: ['filters'], definition: { stage: 'Lead' },
    })
    expect(JSON.stringify(out)).not.toContain('"A"')
  })
})
