import { describe, it, expect } from 'vitest'
import { TEXTS, textFor, smsHref, firstName } from './dialTexts'

describe('firstName', () => {
  it('is the first word, or "there"', () => {
    expect(firstName('Sam Golden')).toBe('Sam')
    expect(firstName('  ')).toBe('there')
    expect(firstName(null)).toBe('there')
  })
})

describe('textFor', () => {
  it('fills the first name into the book template', () => {
    expect(textFor('bay', 'a1', 'Sam Golden')).toBe("Hi Sam, this is Chandler with Bayway. Just tried calling about your home loan. When's a good time to talk?")
    expect(textFor('mpg', 'a3', 'Ana Ruiz')).toBe('Hey Ana, Chandler again. Got a few minutes this week to look at your processing rates?')
  })
  it('has every lead step for both books, and credit repair for Bayway only', () => {
    for (const book of ['bay', 'mpg']) for (const k of ['a1', 'a3', 'a5', 'a6', 'nurture']) expect(TEXTS[book][k]).toBeTruthy()
    expect(textFor('bay', 'credit_repair', 'Sam')).toMatch(/^Hi Sam, checking in on how the credit/)
    expect(textFor('mpg', 'credit_repair', 'Sam')).toBe(null)
    expect(textFor('bay', null, 'Sam')).toBe(null)
  })
  it('reads like a person: no dashes or sign-offs', () => {
    for (const book of Object.values(TEXTS)) for (const t of Object.values(book)) expect(t).not.toMatch(/[—–]|Best,|Thanks!$/)
  })
})

describe('smsHref', () => {
  it('is an sms: link with the digits and the encoded body', () => {
    expect(smsHref('(913) 713-5946', 'Hi Sam, ok?')).toBe('sms:9137135946?&body=Hi%20Sam%2C%20ok%3F')
    expect(smsHref('+1 913 713 5946', 'x')).toBe('sms:+19137135946?&body=x')
    expect(smsHref('', 'x')).toBe(null)
  })
})
