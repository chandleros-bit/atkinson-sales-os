// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  callAttrs,
  callFromTarget,
  savePendingCall,
  readPendingCall,
  markCallLeft,
  clearPendingCall,
  postCallNote,
  MAX_AGE_MS,
} from './pendingCall'

const T = 1_800_000_000_000

beforeEach(() => window.localStorage.clear())

describe('callAttrs', () => {
  it('tags a link with the contact', () => {
    expect(callAttrs({ id: 'c1', book: 'bay', name: 'Sam Lee' })).toEqual({
      'data-call-id': 'c1',
      'data-call-book': 'bay',
      'data-call-name': 'Sam Lee',
    })
  })
  it('is empty without an id or book', () => {
    expect(callAttrs({ book: 'bay' })).toEqual({})
    expect(callAttrs({ id: 'c1' })).toEqual({})
  })
})

describe('callFromTarget', () => {
  it('reads the contact off a tagged tel: link, from a child of it too', () => {
    document.body.innerHTML = '<a href="tel:9137135946" data-call-id="c1" data-call-book="mpg" data-call-name="Sam"><svg><path id="p"/></svg></a>'
    expect(callFromTarget(document.getElementById('p'))).toEqual({ id: 'c1', book: 'mpg', name: 'Sam', phone: '9137135946' })
  })
  it('ignores untagged tel: links and other links', () => {
    document.body.innerHTML = '<a id="a" href="tel:1"></a><a id="b" href="/x" data-call-id="c1"></a>'
    expect(callFromTarget(document.getElementById('a'))).toBe(null)
    expect(callFromTarget(document.getElementById('b'))).toBe(null)
    expect(callFromTarget(null)).toBe(null)
  })
})

describe('pending call storage', () => {
  const call = { id: 'c1', book: 'bay', name: 'Sam', phone: '1' }

  it('saves, marks left, and clears', () => {
    savePendingCall(call, T)
    expect(readPendingCall(T + 1000)).toEqual({ ...call, at: T, left: false })
    markCallLeft(T + 2000)
    expect(readPendingCall(T + 3000).left).toBe(true)
    clearPendingCall()
    expect(readPendingCall(T + 3000)).toBe(null)
  })

  it('goes stale after two hours', () => {
    savePendingCall(call, T)
    expect(readPendingCall(T + MAX_AGE_MS - 1)).not.toBe(null)
    expect(readPendingCall(T + MAX_AGE_MS)).toBe(null)
  })

  it('survives junk in storage', () => {
    window.localStorage.setItem('os.pendingCall', '{nope')
    expect(readPendingCall(T)).toBe(null)
    markCallLeft(T)
  })
})

describe('postCallNote', () => {
  it('joins the note and the text', () => {
    expect(postCallNote(' Wants a quote ', 'Hi Sam')).toBe('Wants a quote\n\nTexted: Hi Sam')
    expect(postCallNote('', 'Hi Sam')).toBe('Texted: Hi Sam')
    expect(postCallNote('Only a note', null)).toBe('Only a note')
    expect(postCallNote('  ', null)).toBe('')
  })
})
