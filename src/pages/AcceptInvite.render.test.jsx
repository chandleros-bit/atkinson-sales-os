// @vitest-environment jsdom
// /accept-invite: nothing is spent until the button is pressed (mail scanners
// open links but do not click), then the new login sets a password.
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let authValue = { session: null, loading: false }
vi.mock('../context/AuthContext', () => ({ useAuth: () => authValue }))

const verifyOtp = vi.fn()
const updateUser = vi.fn()
vi.mock('../lib/supabase', () => ({
  isDemoMode: false,
  supabase: { auth: { verifyOtp: (...a) => verifyOtp(...a), updateUser: (...a) => updateUser(...a) } },
}))

const { default: AcceptInvite } = await import('./AcceptInvite')

async function mount(url) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () =>
    createRoot(host).render(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/accept-invite" element={<AcceptInvite />} />
          <Route path="/" element={<div>HOME</div>} />
          <Route path="/login" element={<div>LOGIN</div>} />
        </Routes>
      </MemoryRouter>,
    ),
  )
  return host
}
const button = (host, text) => [...host.querySelectorAll('button')].find((b) => b.textContent.includes(text))
function type(input, value) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  set.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('AcceptInvite', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    authValue = { session: null, loading: false }
    verifyOtp.mockReset()
    updateUser.mockReset()
  })

  it('does not spend the link until Accept invite is pressed', async () => {
    verifyOtp.mockResolvedValue({ data: { session: {} }, error: null })
    const host = await mount('/accept-invite?token_hash=abc&type=invite')
    expect(verifyOtp).not.toHaveBeenCalled()
    await act(async () => button(host, 'Accept invite').click())
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: 'abc', type: 'invite' })
    expect(host.querySelector('#new-password')).not.toBe(null)
  })

  it('says the link is used up when verification fails', async () => {
    verifyOtp.mockResolvedValue({ data: null, error: { message: 'Token has expired or is invalid' } })
    const host = await mount('/accept-invite?token_hash=abc&type=invite')
    await act(async () => button(host, 'Accept invite').click())
    expect(host.textContent).toMatch(/expired or was already used/)
    expect(host.querySelector('#new-password')).toBe(null)
  })

  it('shows the Supabase error from an old link', async () => {
    const host = await mount('/accept-invite#error=access_denied&error_description=Email+link+is+invalid+or+has+expired')
    expect(host.textContent).toMatch(/expired or was already used/)
  })

  it('sets the password and goes home', async () => {
    authValue = { session: { user: { id: 'u1' } }, loading: false }
    updateUser.mockResolvedValue({ data: {}, error: null })
    const host = await mount('/accept-invite')
    await act(async () => {
      type(host.querySelector('#new-password'), 'goodpass123')
      type(host.querySelector('#confirm-password'), 'goodpass123')
    })
    await act(async () => button(host, 'Save password').click())
    expect(updateUser).toHaveBeenCalledWith({ password: 'goodpass123' })
    expect(host.textContent).toContain('HOME')
  })

  it('blocks a short password', async () => {
    authValue = { session: { user: { id: 'u1' } }, loading: false }
    const host = await mount('/accept-invite')
    await act(async () => {
      type(host.querySelector('#new-password'), 'short')
      type(host.querySelector('#confirm-password'), 'short')
    })
    await act(async () => button(host, 'Save password').click())
    expect(updateUser).not.toHaveBeenCalled()
    expect(host.textContent).toMatch(/8 characters/)
  })

  it('reset links read Reset password', async () => {
    const host = await mount('/accept-invite?token_hash=abc&type=recovery')
    expect(button(host, 'Continue to reset password')).toBeTruthy()
  })
})
