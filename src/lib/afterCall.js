// After the call (Workbench v2 spec 2026-11-23, §12). Pure helpers for the Log
// call form: a follow-up date read out of the note ("expects it Wednesday"),
// and the drafted update text to a loan's buyer's agent.

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const MON_SHORT = MONTHS.map((m) => m[0].toUpperCase() + m.slice(1, 3))

const pad = (n) => String(n).padStart(2, '0')
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const startOf = (now) => {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d
}
const addDays = (d, n) => {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

const DAY_RE = '(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|sday|nesday|rsday|urday)?'
const MONTH_RE = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*'
const dayIndex = (word) => DAYS.findIndex((d) => d.startsWith(word.slice(0, 3)))

// The sentence around a match, as a short follow-up reason.
function reasonAt(note, index) {
  const start = Math.max(note.lastIndexOf('.', index) + 1, note.lastIndexOf('\n', index) + 1, 0)
  const endDot = note.indexOf('.', index)
  const end = endDot === -1 ? note.length : endDot
  const s = note.slice(start, end).trim().replace(/\s+/g, ' ')
  return s.length > 60 ? `${s.slice(0, 57).trimEnd()}…` : s
}

// The first future date the note names -> { date 'YYYY-MM-DD', label, title } or null.
// Reads: tomorrow, a weekday ("Wed", "next Friday"), next week (Monday),
// "Dec 4" / "December 4", and "12/4". A weekday or date that's today or past
// moves to its next occurrence.
export function noteDate(note, now = Date.now()) {
  const text = String(note || '')
  if (!text.trim()) return null
  const today = startOf(now)
  const lower = text.toLowerCase()
  const hits = []

  for (const m of lower.matchAll(/\btomorrow\b/g)) hits.push({ index: m.index, date: addDays(today, 1) })
  for (const m of lower.matchAll(/\bnext week\b/g)) {
    const back = (8 - today.getDay()) % 7 || 7
    hits.push({ index: m.index, date: addDays(today, back) })
  }
  for (const m of lower.matchAll(new RegExp(`\\b(next\\s+)?${DAY_RE}\\b`, 'g'))) {
    const i = dayIndex(m[2])
    if (i < 0) continue
    // "next Wednesday" said on a Monday means this coming one, like "Wednesday".
    const ahead = (i - today.getDay() + 7) % 7 || 7
    hits.push({ index: m.index, date: addDays(today, ahead) })
  }
  for (const m of lower.matchAll(new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'g'))) {
    const mon = MONTHS.findIndex((x) => x.startsWith(m[1].slice(0, 3)))
    const day = Number(m[2])
    if (mon < 0 || day < 1 || day > 31) continue
    let d = new Date(today.getFullYear(), mon, day)
    if (d <= today) d = new Date(today.getFullYear() + 1, mon, day)
    hits.push({ index: m.index, date: d })
  }
  for (const m of lower.matchAll(/\b(\d{1,2})\/(\d{1,2})\b/g)) {
    const mon = Number(m[1]) - 1
    const day = Number(m[2])
    if (mon < 0 || mon > 11 || day < 1 || day > 31) continue
    let d = new Date(today.getFullYear(), mon, day)
    if (d <= today) d = new Date(today.getFullYear() + 1, mon, day)
    hits.push({ index: m.index, date: d })
  }

  const first = hits.filter((h) => h.date > today).sort((a, b) => a.index - b.index)[0]
  if (!first) return null
  const days = Math.round((first.date - today) / 86_400_000)
  const label = days === 1 ? 'Tomorrow' : days < 7 ? SHORT[first.date.getDay()] : `${MON_SHORT[first.date.getMonth()]} ${first.date.getDate()}`
  const reason = reasonAt(text, first.index)
  return { date: keyOf(first.date), label, title: reason ? `Check back · ${reason}` : 'Check back' }
}

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'there'

// The drafted text to a loan's buyer's agent after a call. null without a note.
export function agentUpdateText({ agentName, borrowerName, note }) {
  const body = String(note || '').trim().replace(/\s+/g, ' ').replace(/[.!\s]+$/, '')
  if (!body) return null
  return `Hi ${firstName(agentName)}, quick update on ${String(borrowerName || 'your buyer').trim()}: ${body}. - Chandler`
}

// The Log call form's keyboard: 1-6 pick an outcome (in the CRM's order).
export const outcomeForKey = (key, outcomes) => {
  const n = Number(key)
  return Number.isInteger(n) && n >= 1 && n <= outcomes.length ? outcomes[n - 1] : null
}
