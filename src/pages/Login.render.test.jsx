// @vitest-environment jsdom
// Forgot password emails a link that lands on /accept-invite.
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ signIn: async () => null }) }))
const resetPasswordForEmail = vi.fn(async () => ({ data: {}, error: null }))
vi.mock('../lib/supabase', () => ({
  isDemoMode: false,
  supabase: { auth: { resetPasswordForEmail: (...a) => resetPasswordForEmail(...a) } },
}))

const { default: Login } = await import('./Login')

const button = (host, text) => [...host.querySelectorAll('button')].find((b) => b.textContent.includes(text))

describe('Login forgot password', () => {
  it('sends a reset link that lands on /accept-invite', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    await act(async () => createRoot(host).render(<MemoryRouter><Login /></MemoryRouter>))
    await act(async () => button(host, 'Forgot password?').click())
    expect(host.querySelector('#password')).toBe(null)
    await act(async () => {
      const input = host.querySelector('#email')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'shelby@example.com')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => button(host, 'Send reset link').click())
    expect(resetPasswordForEmail).toHaveBeenCalledWith('shelby@example.com', { redirectTo: `${window.location.origin}/accept-invite` })
    expect(host.textContent).toMatch(/reset link is on its way/)
  })
})
