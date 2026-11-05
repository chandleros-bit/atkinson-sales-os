// TRID planning dates (spec section 5). Dates are 'YYYY-MM-DD' keys; all
// arithmetic is UTC so no time zone can shift a day. Separate from
// briefingTime.addBusinessDays, which counts weekdays only.
const DAY = 86400000
const toKey = (ms) => new Date(ms).toISOString().slice(0, 10)
const toMs = (key) => Date.parse(`${key}T00:00:00Z`)
const weekday = (key) => new Date(toMs(key)).getUTCDay()

// nth weekday (0=Sun..6=Sat) of a month; n = -1 for the last one.
function nthWeekday(year, month, dow, n) {
  if (n > 0) {
    const first = new Date(Date.UTC(year, month, 1)).getUTCDay()
    return Date.UTC(year, month, 1 + ((dow - first + 7) % 7) + (n - 1) * 7)
  }
  const lastDay = new Date(Date.UTC(year, month + 1, 0))
  return Date.UTC(year, month, lastDay.getUTCDate() - ((lastDay.getUTCDay() - dow + 7) % 7))
}

// Fixed-date holidays move to Friday (Saturday) or Monday (Sunday).
function observed(ms) {
  const d = new Date(ms).getUTCDay()
  return d === 6 ? ms - DAY : d === 0 ? ms + DAY : ms
}

const cache = new Map()
export function federalHolidays(year) {
  if (cache.has(year)) return cache.get(year)
  const fixed = [
    [0, 1], // New Year's Day
    [5, 19], // Juneteenth
    [6, 4], // Independence Day
    [10, 11], // Veterans Day
    [11, 25], // Christmas
  ].map(([m, d]) => observed(Date.UTC(year, m, d)))
  const floating = [
    nthWeekday(year, 0, 1, 3), // MLK Day
    nthWeekday(year, 1, 1, 3), // Washington's Birthday
    nthWeekday(year, 4, 1, -1), // Memorial Day
    nthWeekday(year, 8, 1, 1), // Labor Day
    nthWeekday(year, 9, 1, 2), // Columbus Day
    nthWeekday(year, 10, 4, 4), // Thanksgiving
  ]
  const set = new Set([...fixed, ...floating].map(toKey))
  cache.set(year, set)
  return set
}

// Next year's New Year's Day can be observed on Dec 31 of this year.
const isHoliday = (key) => {
  const y = Number(key.slice(0, 4))
  return federalHolidays(y).has(key) || federalHolidays(y + 1).has(key)
}

export const isGeneralBusinessDay = (key) => {
  const d = weekday(key)
  return d !== 0 && d !== 6 && !isHoliday(key)
}
export const isSpecificBusinessDay = (key) => weekday(key) !== 0 && !isHoliday(key)

export function addBizDays(key, n, isBiz) {
  let ms = toMs(key)
  const step = n < 0 ? -DAY : DAY
  let left = Math.abs(n)
  while (left > 0) {
    ms += step
    if (isBiz(toKey(ms))) left -= 1
  }
  return toKey(ms)
}

export function tridDates({ application, mailed, closing }) {
  const leBy = addBizDays(application, 3, isGeneralBusinessDay)
  const leReceived = mailed ? addBizDays(leBy, 3, isSpecificBusinessDay) : leBy
  const earliestClosing = addBizDays(leBy, 7, isSpecificBusinessDay)
  const cdReceiveBy = closing ? addBizDays(closing, -3, isSpecificBusinessDay) : null
  const cdSendBy = cdReceiveBy && mailed ? addBizDays(cdReceiveBy, -3, isSpecificBusinessDay) : cdReceiveBy
  return { leBy, leReceived, earliestClosing, cdReceiveBy, cdSendBy }
}
