// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { appEmailOfferFor, openAppEmail } from './appEmail'

const ok = (steps) => steps.map((step) => ({ step, ok: true }))

describe('appEmailOfferFor', () => {
  it('offers after a move to Application Sent', () => {
    expect(appEmailOfferFor({ request: { action: 'set_stage', contact_id: 'c1', payload: { target: 'application_sent' } }, results: ok(['set_stage']) })).toBe('c1')
    expect(appEmailOfferFor({ request: { action: 'log_call', contact_id: 'c1', payload: { set_stage: 'application_sent' } }, results: ok(['log_call', 'set_stage']) })).toBe('c1')
  })
  it('does not offer for other targets or a failed move', () => {
    expect(appEmailOfferFor({ request: { action: 'set_stage', contact_id: 'c1', payload: { target: 'estimate_sent' } }, results: ok(['set_stage']) })).toBeNull()
    expect(appEmailOfferFor({ request: { action: 'set_stage', contact_id: 'c1', payload: { target: 'application_sent' } }, results: [{ step: 'set_stage', ok: false }] })).toBeNull()
    expect(appEmailOfferFor({ request: { action: 'send_app_email', contact_id: 'c1', payload: {} }, results: ok(['app_email']) })).toBeNull()
    expect(appEmailOfferFor({ status: 'ok', results: ok(['set_stage']) })).toBeNull()
    expect(appEmailOfferFor(null)).toBeNull()
  })
})

describe('openAppEmail', () => {
  it('fires app-email:open with the contact', () => {
    const seen = vi.fn()
    window.addEventListener('app-email:open', (e) => seen(e.detail))
    openAppEmail('c9')
    expect(seen).toHaveBeenCalledWith({ contactId: 'c9' })
  })
})
