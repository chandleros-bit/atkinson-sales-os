import { describe, it, expect } from 'vitest'
import { crmProfileUrl, FUB_PERSON_BASE, ZOHO_LEAD_BASE } from './crm'

describe('crmProfileUrl', () => {
  it('builds a FollowUpBoss person URL for Bayway', () => {
    expect(crmProfileUrl('bay', 2972)).toBe(`${FUB_PERSON_BASE}2972`)
  })
  it('builds a Zoho Leads URL for MPG', () => {
    expect(crmProfileUrl('mpg', '4533122000026348024')).toBe(
      `${ZOHO_LEAD_BASE}4533122000026348024`,
    )
  })
  it('returns null when the external id is missing', () => {
    expect(crmProfileUrl('bay', null)).toBeNull()
    expect(crmProfileUrl('bay', undefined)).toBeNull()
    expect(crmProfileUrl('bay', '')).toBeNull()
  })
  it('returns null for an unknown business', () => {
    expect(crmProfileUrl('xyz', 1)).toBeNull()
  })
  it('keeps id 0 linkable (falsy but valid)', () => {
    expect(crmProfileUrl('bay', 0)).toBe(`${FUB_PERSON_BASE}0`)
  })
})
