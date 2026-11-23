// The Workbench day's order (Workbench v2 spec 2026-11-23, §4, decision 1).
// Pure. On the first load after 6 AM Central the three lists' item keys are
// saved (workbench_days); for the rest of the day the lists keep that order.
// Items that arrive later wait in "New since 8:00" until pulled in, except
// the urgent kinds: people who reached out and brand-new leads. The last
// saved day's unfinished items go first in the new day's order.
import { itemKey } from './workNext'
import { chicagoParts } from './briefingTime'

export const ORDER_HOUR = 6

// Has the day's order been due yet (6 AM Central or later)?
export const isOrderTime = (now = Date.now()) => chicagoParts(now).hour >= ORDER_HOUR
export const dayKeyOf = (now = Date.now()) => chicagoParts(now).dateKey

// Urgent items never wait in New since: they go straight to the top of their list.
export const isUrgent = (item) => item?.bucket === 'reached_out' || (item?.kind === 'attempt' && item?.step === 1)

// The order to save for a new day. last: the previous saved day's row
// ({ lists, pulled_in }) or null. -> { calls: [key...], files: [...], partners: [...] }
export function initialOrder(lists, last = null) {
  const out = {}
  for (const l of lists || []) {
    const keys = l.items.map(itemKey)
    const present = new Set(keys)
    const before = [...(last?.lists?.[l.key] || []), ...(last?.pulled_in || [])]
    const rolled = [...new Set(before)].filter((k) => present.has(k))
    const rolledSet = new Set(rolled)
    out[l.key] = [...rolled, ...keys.filter((k) => !rolledSet.has(k))]
  }
  return out
}

// The live lists in the saved order. saved: today's row ({ lists, pulled_in })
// or null (no order yet: the lists stay as built).
// -> { lists, newSince: [{ listKey, key, item }], rolled: Set<key> }
export function applyDayOrder(lists, saved) {
  if (!saved) return { lists, newSince: [] }
  const pulled = saved.pulled_in || []
  const pulledAt = new Map(pulled.map((k, i) => [k, i]))
  const newSince = []
  const out = (lists || []).map((l) => {
    const order = saved.lists?.[l.key] || []
    const at = new Map(order.map((k, i) => [k, i]))
    const urgent = []
    const kept = []
    const pulledIn = []
    for (const item of l.items) {
      const k = itemKey(item)
      if (at.has(k)) kept.push(item)
      else if (pulledAt.has(k)) pulledIn.push(item)
      else if (isUrgent(item)) urgent.push(item)
      else newSince.push({ listKey: l.key, key: k, item })
    }
    kept.sort((a, b) => at.get(itemKey(a)) - at.get(itemKey(b)))
    pulledIn.sort((a, b) => pulledAt.get(itemKey(a)) - pulledAt.get(itemKey(b)))
    const items = [...urgent, ...kept, ...pulledIn]
    const keep = new Set(items)
    const flaggedItems = (l.flaggedItems || []).filter((i) => keep.has(i))
    return { ...l, items, count: items.length, flagged: flaggedItems.length, flaggedItems }
  })
  return { lists: out, newSince }
}

// A New since entry's display name.
export const itemName = (item) => item?.name || item?.row?.name || item?.title || '(no name)'
