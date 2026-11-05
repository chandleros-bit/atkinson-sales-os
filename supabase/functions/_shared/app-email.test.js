import { describe, it, expect } from 'vitest'
import {
  APP_EMAIL_VARIANTS, APP_EMAIL_LINK, FUB_FIRST_NAME,
  variantFor, w2Years, renderAppEmail, defaultVariant, hasAppEmailTag,
} from './app-email.ts'

const NOV = new Date('2026-11-05T15:00:00Z')

describe('w2Years', () => {
  it('is the two years before this one, in Chicago time', () => {
    expect(w2Years(NOV)).toBe('2024 & 2025')
    // 2027-01-01 03:00Z is still Dec 31 in Chicago
    expect(w2Years(new Date('2027-01-01T03:00:00Z'))).toBe('2024 & 2025')
    expect(w2Years(new Date('2027-01-01T08:00:00Z'))).toBe('2025 & 2026')
  })
})

describe('renderAppEmail', () => {
  it('fills name, goal, years and the link; fixes the typo', () => {
    const { subject, html } = renderAppEmail({ variant: 'first_home', firstName: 'Miranda', now: NOV })
    expect(subject).toBe('Your pre-approval: next steps')
    expect(html).toContain('<p>Hey Miranda,</p>')
    expect(html).toContain('about buying your first home!')
    expect(html).toContain(`<a href="${APP_EMAIL_LINK}">Click Here to Start Application</a>`)
    expect(html).toContain('<li>2024 &amp; 2025 W2s</li>')
    expect(html).toContain('<li>Last 30 Day Paystubs</li>')
    expect(html).toContain('I look forward to helping you!')
    expect(html).not.toContain('forwarding')
    expect(html.trim().endsWith('<p>Thank you,</p>')).toBe(true)
  })
  it("has each version's goal line", () => {
    expect(renderAppEmail({ variant: 'next_home', firstName: 'A', now: NOV }).html).toContain('about buying your next home!')
    expect(renderAppEmail({ variant: 'refinance', firstName: 'A', now: NOV }).html).toContain('about refinancing your home!')
  })
  it('escapes the name in a preview', () => {
    expect(renderAppEmail({ variant: 'first_home', firstName: '<b>Jo</b>', now: NOV }).html).toContain('Hey &lt;b&gt;Jo&lt;/b&gt;,')
  })
  it('uses the FUB merge field, never a real name, for FUB', () => {
    const { html } = renderAppEmail({ variant: 'first_home', firstName: 'Miranda', now: NOV, mode: 'fub' })
    expect(html).toContain(`Hey ${FUB_FIRST_NAME},`)
    expect(html).not.toContain('Miranda')
  })
  it('throws on an unknown version', () => {
    expect(() => renderAppEmail({ variant: 'boat', firstName: 'A' })).toThrow(/Unknown/)
  })
})

describe('tags and versions', () => {
  it('has three versions with distinct tags', () => {
    expect(APP_EMAIL_VARIANTS.map((v) => v.key)).toEqual(['first_home', 'next_home', 'refinance'])
    expect(new Set(APP_EMAIL_VARIANTS.map((v) => v.tag)).size).toBe(3)
    expect(variantFor('refinance').tag).toBe('App Email - Refinance')
    expect(variantFor('nope')).toBeNull()
  })
  it('spots an App Email tag in any casing', () => {
    expect(hasAppEmailTag(['Lead', 'app email - next home'])).toBe(true)
    expect(hasAppEmailTag(['application sent'])).toBe(false)
    expect(hasAppEmailTag(null)).toBe(false)
  })
  it('defaults the version from FUB tags', () => {
    expect(defaultVariant(['Refi', 'Zillow'])).toBe('refinance')
    expect(defaultVariant(['Cash-Out Refinance'])).toBe('refinance')
    expect(defaultVariant(['Move Up Buyer'])).toBe('next_home')
    expect(defaultVariant(['repeat buyer'])).toBe('next_home')
    expect(defaultVariant(['First Time Buyer'])).toBe('first_home')
    expect(defaultVariant([])).toBe('first_home')
    expect(defaultVariant(undefined)).toBe('first_home')
  })
})
