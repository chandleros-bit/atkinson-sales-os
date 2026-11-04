// @vitest-environment jsdom
// TemperaturePicker against a fake Supabase: what each tap and Save sends to
// saveRating (undefined = leave alone, null = clear), unpinned close months,
// and a saved month the dropdown does not offer.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import React from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const invoke = vi.fn()
const upserts = []

function query() {
  const q = {}
  for (const m of ['select', 'order', 'range']) q[m] = () => q
  q.upsert = async (row) => {
    upserts.push(row)
    return { error: null }
  }
  q.then = (resolve) => resolve({ data: [], error: null })
  return q
}

vi.mock('../lib/supabase', () => ({
  isDemoMode: false,
  supabase: { from: () => query(), functions: { invoke: (...a) => invoke(...a) } },
}))
vi.mock('../lib/useForecastInputs', () => ({
  useForecast: () => ({ settings: { close_offset_months: { hot: 1, warm: 4, cold: 3 } } }),
}))

const { default: TemperaturePicker } = await import('./TemperaturePicker')
const { default: Toaster } = await import('./Toaster')
const { __resetRatingsForTest } = await import('../lib/useLeadRatings')
const { defaultCloseMonth } = await import('../lib/leadRatings')

async function mount(props) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => {
    createRoot(host).render(
      React.createElement(React.Fragment, null, React.createElement(TemperaturePicker, { contactId: 'c1', businessId: 'bay', ...props }), React.createElement(Toaster)),
    )
  })
}

const group = () => document.querySelector('[aria-label="Lead temperature"]')
const press = async (label) => act(async () => [...document.querySelectorAll('button')].find((b) => b.textContent === label).click())
const amountField = () => document.querySelector('[aria-label="Estimated loan amount"]')
const select = () => document.querySelector('[aria-label="Expected close month"]')
const setValue = async (el, v) =>
  act(async () => {
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v)
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
  })
const monthLabel = (key) => new Date(`${key}T12:00:00`).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
const monthKey = (offset) => {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

beforeEach(() => {
  document.body.innerHTML = ''
  upserts.length = 0
  invoke.mockReset()
  invoke.mockResolvedValue({ data: { status: 'ok', results: [{ step: 'set_temperature', ok: true }] }, error: null })
  __resetRatingsForTest()
})

const warm = { contact_id: 'c1', business_id: 'bay', temperature: 'warm', est_amount: 250000, close_month: null }

describe('TemperaturePicker', () => {
  it('names its group "Lead temperature" and confirms a save', async () => {
    await mount({ rating: warm })
    expect(group()).not.toBe(null)
    await press('Hot')
    expect(document.body.textContent).toContain('Temperature saved')
  })

  it('labels the unpinned option with the default month from the forecast offsets', async () => {
    await mount({ rating: warm })
    expect(select().value).toBe('')
    expect(select().options[0].textContent).toBe(`Default (${monthLabel(defaultCloseMonth('warm', Date.now(), { hot: 1, warm: 4, cold: 3 }))})`)
  })

  it('a same-temperature tap on an unpinned lead keeps it unpinned', async () => {
    await mount({ rating: warm })
    await press('Warm')
    expect(upserts[0].close_month).toBe(null)
  })

  it('a different temperature resets the month; a same one keeps a pinned month', async () => {
    const pinned = monthKey(3)
    await mount({ rating: { ...warm, close_month: pinned } })
    await press('Warm')
    expect(upserts[0].close_month).toBe(pinned)
    await press('Hot')
    expect(upserts[1]).toMatchObject({ temperature: 'hot', close_month: null })
  })

  it('Save sends the chosen month, or null for Default', async () => {
    await mount({ rating: warm })
    await setValue(select(), monthKey(2))
    await press('Save')
    expect(upserts[0].close_month).toBe(monthKey(2))
    await setValue(select(), '')
    await press('Save')
    expect(upserts[1].close_month).toBe(null)
  })

  it('offers a saved month outside the list, marked past when it is', async () => {
    const old = monthKey(-2)
    await mount({ rating: { ...warm, close_month: old } })
    expect(select().value).toBe(old)
    const opt = [...select().options].find((o) => o.value === old)
    expect(opt.textContent).toContain('(past)')
    expect(opt.textContent).toContain(monthLabel(old))
  })

  it('offers a far-future saved month without "(past)"', async () => {
    const far = monthKey(12)
    await mount({ rating: { ...warm, close_month: far } })
    const opt = [...select().options].find((o) => o.value === far)
    expect(opt.textContent).toContain(monthLabel(far))
    expect(opt.textContent).not.toContain('(past)')
  })

  it('a Cold tap leaves the amount alone, even with the field still filled', async () => {
    await mount({ rating: { ...warm, temperature: 'hot' } })
    await press('Cold')
    expect(upserts[0].temperature).toBe('cold')
    expect('est_amount' in upserts[0]).toBe(false)
  })

  it('a Hot / Warm tap sends the field amount, and leaves it alone when empty or 0', async () => {
    await mount({ rating: warm })
    await setValue(amountField(), '300000')
    await press('Hot')
    expect(upserts[0].est_amount).toBe(300000)
    await setValue(amountField(), '0')
    await press('Hot')
    expect('est_amount' in upserts[1]).toBe(false)
    await setValue(amountField(), '')
    await press('Hot')
    expect('est_amount' in upserts[2]).toBe(false)
  })

  it('Save clears the amount when the field is blank or 0, and caps its length', async () => {
    await mount({ rating: warm })
    expect(amountField().maxLength).toBe(12)
    await setValue(amountField(), '0')
    await press('Save')
    expect(upserts[0].est_amount).toBe(null)
  })

  it('sends no amount for an MPG lead', async () => {
    await mount({ businessId: 'mpg', rating: { ...warm, business_id: 'mpg' } })
    expect(amountField()).toBe(null)
    await press('Hot')
    await press('Save')
    expect(upserts.every((u) => !('est_amount' in u))).toBe(true)
  })
})
