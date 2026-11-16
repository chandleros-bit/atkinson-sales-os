// @vitest-environment jsdom
// The post-call pop-up: nothing until a tagged tel: link is tapped and the tab
// goes hidden and comes back; then notes + texts; Save adds a note, Skip drops it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import React from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const sent = []
const toasts = []
vi.mock('../lib/writeback', () => ({
  invokeCrmAction: async (req) => {
    sent.push(req)
    return { status: 'ok', results: [{ step: 'push_note', ok: true }] }
  },
}))
vi.mock('./Toaster', () => ({ showToast: (t) => toasts.push(t) }))

const { default: PostCallHost } = await import('./PostCallHost')

let host, root
let visibility = 'visible'
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })

const setVisibility = async (v) => {
  visibility = v
  await act(async () => document.dispatchEvent(new Event('visibilitychange')))
}
const dialog = () => document.querySelector('[role="dialog"]')
const buttonNamed = (name) => [...document.querySelectorAll('button')].find((b) => b.textContent === name)

async function mount() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root.render(<PostCallHost />))
}

function tapCall() {
  const a = document.createElement('a')
  a.href = 'tel:9137135946'
  a.dataset.callId = 'c1'
  a.dataset.callBook = 'bay'
  a.dataset.callName = 'Sam Lee'
  a.addEventListener('click', (e) => e.preventDefault())
  document.body.appendChild(a)
  a.click()
}

beforeEach(async () => {
  sent.length = 0
  toasts.length = 0
  visibility = 'visible'
  window.localStorage.clear()
  await mount()
})
afterEach(async () => {
  await act(async () => root.unmount())
  document.body.innerHTML = ''
})

describe('PostCallHost', () => {
  it('stays closed until the tab leaves for the call and comes back', async () => {
    tapCall()
    await setVisibility('visible')
    expect(dialog()).toBe(null)
    await setVisibility('hidden')
    expect(dialog()).toBe(null)
    await setVisibility('visible')
    expect(dialog().textContent).toContain('After the call with Sam Lee')
  })

  it('ignores untagged tel: links', async () => {
    const a = document.createElement('a')
    a.href = 'tel:1'
    a.addEventListener('click', (e) => e.preventDefault())
    document.body.appendChild(a)
    a.click()
    await setVisibility('hidden')
    await setVisibility('visible')
    expect(dialog()).toBe(null)
  })

  it('offers both texts as Messages links with the first name', async () => {
    tapCall()
    await setVisibility('hidden')
    await setVisibility('visible')
    const missed = dialog().querySelector('[data-post-call-text="after_missed"] a')
    expect(missed.getAttribute('href')).toMatch(/^sms:9137135946\?&body=Hi%20Sam%2C%20this%20is%20Chandler/)
    expect(dialog().querySelector('[data-post-call-text="after_talked"] a').getAttribute('href')).toMatch(/Great%20talking%20with%20you%2C%20Sam/)
  })

  it('saves the note and the opened text as one CRM note, then closes', async () => {
    tapCall()
    await setVisibility('hidden')
    await setVisibility('visible')
    expect(buttonNamed('Save note').disabled).toBe(true)

    const textarea = dialog().querySelector('textarea')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      setter.call(textarea, 'Wants a rate quote Friday')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const link = dialog().querySelector('[data-post-call-text="after_talked"] a')
    link.addEventListener('click', (e) => e.preventDefault())
    await act(async () => link.click())
    expect(link.textContent).toBe('Opened in Messages')

    // Off to Messages and back: same sheet, note kept.
    await setVisibility('hidden')
    await setVisibility('visible')
    expect(dialog().querySelector('textarea').value).toBe('Wants a rate quote Friday')

    await act(async () => buttonNamed('Save note').click())
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ action: 'add_note', contact_id: 'c1' })
    expect(sent[0].payload.body).toBe('Wants a rate quote Friday\n\nTexted: Great talking with you, Sam. Text me here anytime if anything comes up.')
    expect(toasts[0].tone).toBe('ok')
    expect(dialog()).toBe(null)
    expect(window.localStorage.getItem('os.pendingCall')).toBe(null)
  })

  it('Skip drops the call without saving', async () => {
    tapCall()
    await setVisibility('hidden')
    await setVisibility('visible')
    await act(async () => buttonNamed('Skip').click())
    expect(dialog()).toBe(null)
    expect(sent).toHaveLength(0)
    await setVisibility('hidden')
    await setVisibility('visible')
    expect(dialog()).toBe(null)
  })

  it('reopens after a reload while the call was going', async () => {
    tapCall()
    await act(async () => root.unmount())
    await mount()
    expect(dialog().textContent).toContain('Sam Lee')
  })
})
