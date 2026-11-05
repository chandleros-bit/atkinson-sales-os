import { describe, it, expect } from 'vitest'
import { lookupUrls, leadAddress, isHttpUrl, groupLinks, GROUP_ORDER } from './referenceLinks'

describe('lookupUrls', () => {
  it('puts the address in each search link', () => {
    const u = lookupUrls('3042 Oak Forest Dr, Houston, TX 77018')
    expect(u.har).toBe('https://www.har.com/search/dosearch?quicksearch=3042%20Oak%20Forest%20Dr%2C%20Houston%2C%20TX%2077018')
    expect(u.maps).toBe('https://www.google.com/maps/search/?api=1&query=3042%20Oak%20Forest%20Dr%2C%20Houston%2C%20TX%2077018')
    expect(u.zillow).toBe('https://www.zillow.com/homes/3042-Oak-Forest-Dr-Houston-TX-77018_rb/')
  })
})

describe('leadAddress', () => {
  it('formats the first address with a street', () => {
    expect(leadAddress({ addresses: [{ street: '3042 Oak Forest Dr ', city: 'Houston', state: 'TX', code: '77018' }] })).toBe('3042 Oak Forest Dr, Houston, TX 77018')
  })
  it('skips city-only entries and missing data', () => {
    expect(leadAddress({ addresses: [{ city: 'Houston', state: 'TX' }] })).toBe(null)
    expect(leadAddress({})).toBe(null)
    expect(leadAddress(null)).toBe(null)
  })
})

describe('isHttpUrl and groupLinks', () => {
  it('accepts http(s) only', () => {
    expect(isHttpUrl('https://har.com')).toBe(true)
    expect(isHttpUrl('har.com')).toBe(false)
    expect(isHttpUrl('ftp://x')).toBe(false)
  })
  it('groups in the fixed order, others after, sorted by sort', () => {
    const g = groupLinks([
      { id: 1, grp: 'Licensing', sort: 2, title: 'B' },
      { id: 2, grp: 'Zeta', sort: 1, title: 'Z' },
      { id: 3, grp: 'Property', sort: 1, title: 'A' },
      { id: 4, grp: 'Licensing', sort: 1, title: 'C' },
    ])
    expect(g.map((x) => x.grp)).toEqual(['Property', 'Licensing', 'Zeta'])
    expect(g[1].links.map((l) => l.id)).toEqual([4, 1])
    expect(GROUP_ORDER[0]).toBe('Property')
  })
})
