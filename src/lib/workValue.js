// What a Workbench item is worth (Workbench v2 spec 2026-11-23, §8 and §9).
// Pure. A loan in Arive shows its exact estimated commission; a rated lead
// with no loan shows a band from its forecast line (payout × odds); anything
// else shows nothing. The assistant never sees these.
import { estComp, isScenario } from './loans'

const OPEN = new Set(['prospect', 'processing', 'closing'])

// $ under $1K, $$ $1K–$3K, $$$ over $3K.
export function band(amount) {
  if (amount == null || !(amount > 0)) return null
  if (amount < 1000) return '$'
  if (amount <= 3000) return '$$'
  return '$$$'
}

// Contact id -> { amount, exact }. Open Arive loans win (largest comp);
// otherwise an unfunded forecast line from a rating, weighted by its odds.
export function valueIndex({ lines = [], loans = [], rates = null } = {}) {
  const out = new Map()
  for (const l of loans || []) {
    if (!l.contact_id || isScenario(l) || !OPEN.has(l.stage_group)) continue
    const comp = rates ? estComp(l, rates) : null
    if (comp == null) continue
    const cur = out.get(l.contact_id)
    if (!cur || !cur.exact || comp > cur.amount) out.set(l.contact_id, { amount: Math.round(comp), exact: true })
  }
  for (const line of lines || []) {
    if (!line.contactId || line.funded || line.source !== 'rating' || line.payout == null) continue
    if (out.get(line.contactId)?.exact) continue
    out.set(line.contactId, { amount: Math.round((line.payout * line.odds) / 100), exact: false })
  }
  return out
}

// An item's contact id: dial, theme and Up Next rows carry it as `id`; file items as `contactId`.
const contactOf = (item) => item?.contactId ?? (item?.key ? null : item?.id) ?? null

// -> { amount, exact, text } or null. text: "$2,980" when exact, else the band.
export function itemValue(item, index) {
  const v = index?.get(contactOf(item))
  if (!v) return null
  return { ...v, text: v.exact ? `$${v.amount.toLocaleString('en-US')}` : band(v.amount) }
}

// Flagged items across today's lists and what they're worth together.
// lists: workLists() output. -> { count, amount }
export function atRisk(lists, index) {
  let count = 0
  let amount = 0
  for (const l of lists || []) {
    for (const item of l.flaggedItems || []) {
      count += 1
      amount += itemValue(item, index)?.amount || 0
    }
  }
  return { count, amount }
}
