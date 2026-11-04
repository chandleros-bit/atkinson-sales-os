// America/Chicago calendar math for the daily briefing (spec 2026-11-03,
// section 3). The edge function runs in UTC, so nothing here uses the host's
// local time zone: every answer comes from Intl with timeZone America/Chicago.
const TZ = 'America/Chicago'
const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

const parts = (t) =>
  Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
    })
      .formatToParts(new Date(t))
      .map((p) => [p.type, p.value]),
  )

// { dateKey 'YYYY-MM-DD', hour 0-23, minute, weekday 0=Sun }
export function chicagoParts(now = Date.now()) {
  const p = parts(now)
  return { dateKey: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute), weekday: WEEKDAY[p.weekday] }
}

// Weekdays, 7:00-7:59 Chicago. pg_cron fires at 12:30 and 13:30 UTC; exactly
// one of them lands in this window on any date, DST or not.
export function shouldSend(now = Date.now()) {
  const { hour, weekday } = chicagoParts(now)
  return weekday >= 1 && weekday <= 5 && hour === 7
}

// UTC offset (minutes, local minus UTC) of Chicago at instant t.
function offsetMinutes(t) {
  const p = parts(t)
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute))
  return Math.round((asUtc - Math.floor(t / 60000) * 60000) / 60000)
}

const pad = (n) => String(n).padStart(2, '0')

const addDays = (dateKey, n) => {
  const [y, m, d] = dateKey.split('-').map(Number)
  const x = new Date(Date.UTC(y, m - 1, d + n))
  return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`
}

// UTC instant of local midnight for a Chicago 'YYYY-MM-DD'. Chicago's offset
// is -5h or -6h, so try both candidates and keep the one whose local reading
// is exactly midnight of that date (DST changes at 2 AM, never at midnight).
function midnightUtc(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number)
  const guess = Date.UTC(y, m - 1, d)
  for (const off of [5, 6]) {
    const t = guess + off * 3600000
    const p = chicagoParts(t)
    if (p.dateKey === dateKey && p.hour === 0 && p.minute === 0) return t
  }
  // Fallback (unreachable for Chicago): settle the offset by iteration.
  let t = guess - offsetMinutes(guess) * 60000
  t = guess - offsetMinutes(t) * 60000
  return t
}

// { from, to } UTC ISO strings bounding a Chicago calendar day (today + offset).
export function chicagoDayRangeUtc(now = Date.now(), offsetDays = 0) {
  const key = addDays(chicagoParts(now).dateKey, offsetDays)
  return { from: new Date(midnightUtc(key)).toISOString(), to: new Date(midnightUtc(addDays(key, 1))).toISOString() }
}

// Chicago 'YYYY-MM-DD' for today + offset.
export function chicagoDateKey(now = Date.now(), offsetDays = 0) {
  return addDays(chicagoParts(now).dateKey, offsetDays)
}

// Mon-Fri days from today (inclusive) to the end of this Chicago month.
export function businessDaysLeft(now = Date.now()) {
  const today = chicagoParts(now).dateKey
  const [y, m] = today.split('-').map(Number)
  let n = 0
  for (let key = today; Number(key.slice(5, 7)) === m && Number(key.slice(0, 4)) === y; key = addDays(key, 1)) {
    const [yy, mm, dd] = key.split('-').map(Number)
    const wd = new Date(Date.UTC(yy, mm - 1, dd)).getUTCDay()
    if (wd >= 1 && wd <= 5) n += 1
  }
  return n
}

// 'Tue Nov 3' in Chicago.
export function longDateLabel(now = Date.now()) {
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(now)).replace(',', '')
}
