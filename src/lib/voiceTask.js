// Voice quick-add: turn what was said into a Workbench task.
//   "MPG send Vinay picture of shipping receipt for reimbursement, today"
//   -> { book: 'mpg', title: 'Send Vinay picture of …', dueOn: today, names: ['Vinay'] }
// Pure, no I/O. The book is the first word (MPG / Bayway); the due day is a
// day phrase anywhere (today, tomorrow, Friday, next week, Oct 30, 11/5, in
// 3 days); names are words to look up as leads. Dates are local.
import { localDateKey } from './crmActions'

const BOOK = /^\s*(?:(m\.?\s*p\.?\s*g\.?|empg)|(bay\s*way|bay))(?=[\s,.:;-]|$)[\s,.:;-]*/i

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const NUMBERS = { one: 1, a: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }

const WEEKDAY = `(?:${DAYS.join('|')})`
const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
const COUNT = `(?:\\d+|${Object.keys(NUMBERS).join('|')})`
const PHRASE = [
  'today', 'tonight', 'this (?:morning|afternoon|evening)', 'end of (?:the )?day', 'eod',
  'tomorrow', 'next week', 'end of (?:the )?week',
  `(?:this |next )?${WEEKDAY}`,
  `in ${COUNT} (?:days?|weeks?)`,
  `${MONTH}\\.? \\d{1,2}(?:st|nd|rd|th)?`,
  '\\d{1,2}/\\d{1,2}',
].join('|')
// The phrase plus the words that lead into it ("due", "by", "on", a comma).
const DATE = new RegExp(`(?:[\\s,]*(?:due|by|on|for)?\\s*)\\b(${PHRASE})\\b[.,!]?`, 'gi')

const VERBS = /^(?:send|call|text|email|e-mail|ask|remind|tell|pay|message|meet|follow up with|ping)$/i
const NOT_NAMES = new Set(['the', 'a', 'an', 'my', 'his', 'her', 'him', 'them', 'me', 'us', 'back', 'about', 'and', 'for', 'to', 'i'])

function addDays(now, n) {
  const d = new Date(now)
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() + n)
  return d
}

// Days from today to the next `target` weekday (1..7: today's name means a week out).
const ahead = (today, target) => (target - today + 7) % 7 || 7

function dayFor(phrase, now) {
  const p = phrase.toLowerCase().replace(/\s+/g, ' ')
  const today = new Date(now).getDay()
  if (/^(today|tonight|this |end of (the )?day|eod)/.test(p)) return addDays(now, 0)
  if (p === 'tomorrow') return addDays(now, 1)
  if (p === 'next week') return addDays(now, ahead(today, 1))
  if (/^end of (the )?week$/.test(p)) return addDays(now, today === 5 ? 0 : today === 6 ? 6 : ahead(today, 5))
  const wd = p.match(new RegExp(`^(this |next )?(${WEEKDAY})$`))
  if (wd) {
    const n = ahead(today, DAYS.indexOf(wd[2]))
    // "next Friday" on a Thursday is the week after, not tomorrow: if the
    // plain day is still in this week (Mon..Sun), push it a week.
    const daysToSunday = (7 - today) % 7
    return addDays(now, wd[1] === 'next ' && n <= daysToSunday ? n + 7 : n)
  }
  const inN = p.match(/^in (\S+) (days?|weeks?)$/)
  if (inN) {
    const n = NUMBERS[inN[1]] ?? Number(inN[1])
    return addDays(now, inN[2].startsWith('week') ? n * 7 : n)
  }
  let month
  let date
  const md = p.match(/^([a-z]+)\.? (\d{1,2})/)
  if (md) {
    month = MONTHS.indexOf(md[1].slice(0, 3))
    date = Number(md[2])
  } else {
    const slash = p.match(/^(\d{1,2})\/(\d{1,2})$/)
    if (!slash) return null
    month = Number(slash[1]) - 1
    date = Number(slash[2])
  }
  if (month < 0 || month > 11 || date < 1 || date > 31) return null
  const base = new Date(now)
  let d = new Date(base.getFullYear(), month, date, 12)
  if (localDateKey(d) < localDateKey(base)) d = new Date(base.getFullYear() + 1, month, date, 12)
  return d
}

function namesIn(title) {
  const words = title.split(/\s+/).map((w) => w.replace(/[^\p{L}'-]/gu, '')).filter(Boolean)
  const out = []
  const add = (w) => {
    if (w.length >= 3 && !NOT_NAMES.has(w.toLowerCase()) && !out.some((o) => o.toLowerCase() === w.toLowerCase())) out.push(w)
  }
  words.forEach((w, i) => {
    if (i > 0 && VERBS.test(words[i - 1])) add(w)
    else if (i > 0 && /^\p{Lu}/u.test(w)) add(w)
  })
  return out.slice(0, 3)
}

export function parseVoiceTask(text, now = Date.now()) {
  let s = String(text ?? '').trim()
  if (!s) return { book: null, title: '', dueOn: null, names: [] }

  let book = null
  const b = s.match(BOOK)
  if (b) {
    book = b[1] ? 'mpg' : 'bay'
    s = s.slice(b[0].length)
  }

  // The last day phrase wins ("call Monday about the Friday closing, tomorrow").
  let dueOn = null
  const found = [...s.matchAll(DATE)]
  const last = found.at(-1)
  if (last) {
    const d = dayFor(last[1], now)
    if (d) {
      dueOn = localDateKey(d)
      s = `${s.slice(0, last.index)} ${s.slice(last.index + last[0].length)}`
    }
  }

  const clean = s.replace(/\s+/g, ' ').trim().replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, '')
  const title = clean.charAt(0).toUpperCase() + clean.slice(1)
  return { book, title, dueOn, names: namesIn(title) }
}
