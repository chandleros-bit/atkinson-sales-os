import { describe, it, expect, vi } from 'vitest'
import { friendlyError } from './friendlyError'

describe('friendlyError', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  it('hides code-level failures', () => {
    expect(friendlyError(new TypeError("Cannot read properties of null (reading 'rpc')"))).toBe('Something went wrong loading this. Try again.')
    expect(friendlyError('x.limit is not a function')).toBe('Something went wrong loading this. Try again.')
  })
  it('names network and access problems', () => {
    expect(friendlyError(new Error('Failed to fetch'))).toMatch(/connection/)
    expect(friendlyError({ message: 'JWT expired' })).toMatch(/signing in/)
  })
  it('keeps messages that are already written for people', () => {
    expect(friendlyError(new Error('No phone on file in FUB'))).toBe('No phone on file in FUB')
    expect(friendlyError(null)).toBe('Something went wrong. Try again.')
  })
})
