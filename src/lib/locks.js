// Rate locks expiring (Bayway Bot Engine doc, Sales OS week 2). Open, real
// loans whose Arive lock expires within LOCK_WARN_DAYS (10, per the doc), or expired in the last
// LOCK_EXPIRED_LOOKBACK days without funding (needs an extension or relock).
// Flags a firm closing date that falls after the lock. Pure, no I/O.
import { isOpen, isScenario } from './loans'
import { chicagoDateKey } from './briefingTime'

export const LOCK_WARN_DAYS = 10
export const LOCK_EXPIRED_LOOKBACK = 30

const dayNum = (key) => Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10))) / 86_400_000

// -> [{ id, name, expiresOn, daysLeft, expired, closesAfterLock, closingOn }],
// soonest (most overdue) first.
export function locksExpiring(loans, now = Date.now()) {
  const today = chicagoDateKey(now)
  const t = dayNum(today)
  return (loans || [])
    .filter((l) => l.lock_expires_on && !isScenario(l) && isOpen(l) && !l.funded_on)
    .map((l) => {
      const daysLeft = dayNum(l.lock_expires_on) - t
      return {
        id: l.id,
        name: l.borrower_name || '(no name)',
        expiresOn: l.lock_expires_on,
        daysLeft,
        expired: daysLeft < 0,
        closingOn: l.firm_closing_on || null,
        closesAfterLock: !!(l.firm_closing_on && l.firm_closing_on > l.lock_expires_on),
      }
    })
    .filter((r) => r.daysLeft <= LOCK_WARN_DAYS && r.daysLeft >= -LOCK_EXPIRED_LOOKBACK)
    .sort((a, b) => a.daysLeft - b.daysLeft)
}

// "expired 3 days ago" / "expires today" / "expires in 2 days", plus the closing clash.
export function lockDetail(r) {
  const when = r.expired
    ? `expired ${-r.daysLeft} day${r.daysLeft === -1 ? '' : 's'} ago`
    : r.daysLeft === 0
      ? 'expires today'
      : `expires in ${r.daysLeft} day${r.daysLeft === 1 ? '' : 's'}`
  return r.closesAfterLock ? `${when}, closing is after the lock (${r.closingOn})` : when
}
