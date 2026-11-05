import { describe, it, expect } from 'vitest'
import { readAuthLink, passwordProblem } from './authLink'

describe('readAuthLink', () => {
  it('reads an invite token_hash link', () => {
    expect(readAuthLink('?token_hash=abc&type=invite', '')).toEqual({ tokenHash: 'abc', type: 'invite', error: null })
  })
  it('reads a recovery link', () => {
    expect(readAuthLink('?token_hash=xyz&type=recovery', '').type).toBe('recovery')
  })
  it('refuses link types it does not handle', () => {
    expect(readAuthLink('?token_hash=abc&type=signup', '')).toEqual({ tokenHash: null, type: null, error: null })
  })
  it('reads a Supabase error from the hash', () => {
    const r = readAuthLink('', '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired')
    expect(r.error).toBe('Email link is invalid or has expired')
    expect(r.tokenHash).toBe(null)
  })
  it('reads a Supabase error from the query', () => {
    expect(readAuthLink('?error=access_denied&error_description=Denied', '').error).toBe('Denied')
  })
  it('returns nothing for a bare page', () => {
    expect(readAuthLink('', '')).toEqual({ tokenHash: null, type: null, error: null })
  })
})

describe('passwordProblem', () => {
  it('wants at least 8 characters', () => {
    expect(passwordProblem('short', 'short')).toMatch(/8 characters/)
  })
  it('wants both entries to match', () => {
    expect(passwordProblem('longenough1', 'longenough2')).toMatch(/match/)
  })
  it('passes a good password', () => {
    expect(passwordProblem('longenough1', 'longenough1')).toBe(null)
  })
})
