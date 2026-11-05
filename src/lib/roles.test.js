import { describe, it, expect } from 'vitest'
import { canVisit, homeFor, quickActionsFor, ASSISTANT_QUICK_ACTIONS, roleLabel } from './roles'

describe('roles', () => {
  it('lets the owner go anywhere', () => {
    expect(canVisit('owner', '/')).toBe(true)
    expect(canVisit('owner', '/reports')).toBe(true)
  })
  it('keeps the assistant to Workbench, Tasks and Pipeline', () => {
    for (const p of ['/workbench', '/priority', '/tasks', '/pipeline', '/bayway/pipeline', '/reference']) expect(canVisit('assistant', p)).toBe(true)
    for (const p of ['/', '/reports', '/analytics', '/bayway/loans', '/settings', '/sync', '/rate', '/calendar', '/contacts', '/activity', '/mpg/pipeline', '/pipelines']) expect(canVisit('assistant', p)).toBe(false)
  })
  it('lets nobody in without a role', () => {
    expect(canVisit(null, '/workbench')).toBe(false)
  })
  it('sends each role home', () => {
    expect(homeFor('owner')).toBe('/')
    expect(homeFor('assistant')).toBe('/workbench')
  })
  it('narrows Quick Actions for the assistant only', () => {
    expect(ASSISTANT_QUICK_ACTIONS).toEqual(['note', 'followup', 'done'])
    expect(quickActionsFor('owner', undefined)).toBe(undefined)
    expect(quickActionsFor('owner', ['call'])).toEqual(['call'])
    expect(quickActionsFor('assistant', undefined)).toEqual(['note', 'followup', 'done'])
    expect(quickActionsFor('assistant', ['call', 'note'])).toEqual(['note'])
  })
  it('labels the role', () => {
    expect(roleLabel('owner')).toBe('Super Admin')
    expect(roleLabel('assistant')).toBe('Assistant')
  })
})
