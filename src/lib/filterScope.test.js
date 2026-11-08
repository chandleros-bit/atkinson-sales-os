import { describe, it, expect } from 'vitest'
import { filterScope } from './filterScope'

describe('filterScope', () => {
  it('follows All / MPG / Bayway on the cross-book pages', () => {
    for (const p of ['/', '/workbench', '/priority', '/calendar', '/tasks', '/activity', '/reports', '/analytics']) {
      expect(filterScope(p)).toBe('all')
    }
  })
  it('picks one book on Pipeline and Contacts', () => {
    expect(filterScope('/pipeline')).toBe('book')
    expect(filterScope('/contacts')).toBe('book')
  })
  it('hides the switch where it would do nothing', () => {
    for (const p of ['/bayway/loans', '/bayway/pipeline', '/mpg/contacts', '/bayway/priority-leads', '/reference', '/rate', '/settings', '/sync']) {
      expect(filterScope(p)).toBe('none')
    }
  })
})
