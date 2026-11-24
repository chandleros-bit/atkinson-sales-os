// The end-of-day wrap (Workbench v2 spec 2026-11-23, §14). Pure: Workbench
// passes the day's saved order, what's still in the lists and what moved, and
// this builds the wrap. It's shown on screen and saved to
// workbench_days.wrap on Close the day; the 7:30 briefing reads it the next
// business morning (briefing.js wrapLines).
import { itemKey } from './workNext'
import { itemName } from './dayOrder'
import { THEMES } from './dialThemes'

export const WRAP_HOUR = 17
export const WRAP_MINUTE = 30

// Is it time to offer the wrap: the lists are done, or it's 5:30 PM or later?
export function wrapDue(lists, now = Date.now()) {
  const left = (lists || []).reduce((n, l) => n + l.count, 0)
  const d = new Date(now)
  return left === 0 || d.getHours() > WRAP_HOUR || (d.getHours() === WRAP_HOUR && d.getMinutes() >= WRAP_MINUTE)
}

// The next weekday's theme: Friday's next is Monday.
export function tomorrowTheme(now = Date.now()) {
  const d = new Date(now)
  let day = (d.getDay() + 1) % 7
  if (day === 6) day = 1
  if (day === 0) day = 1
  const t = THEMES.find((x) => x.day === day)
  return t ? { ...t, weekday: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day] } : null
}

const LABEL = { calls: 'Calls', files: 'Files', partners: 'Partners' }

// saved: today's workbench_days row ({ lists, pulled_in, wrap }) or null.
// lists: today's lists in the day's order (what's still open).
// filesDone: work items done today (workProgress). callsLogged: calls logged today.
// moved: [{ id, name, stage, value? }] people who changed stage today.
// hardOpen: hard dates still open. gapNow: target - (funded + closing + leadsLow), or null.
// -> { counts: [{ key, label, done, total, note }], moved, gap: { now, morning },
//      rolled: [{ key, list, name }], tomorrow: { theme, weekday, rolled, first } }
export function buildWrap({ saved = null, lists = [], filesDone = 0, callsLogged = 0, moved = [], hardOpen = 0, gapNow = null, now = Date.now() }) {
  const open = new Map(lists.map((l) => [l.key, l]))
  const count = (key) => {
    const list = open.get(key)
    const left = list ? list.count : 0
    const planned = saved?.lists?.[key]?.length ?? left
    const pulled = (saved?.pulled_in || []).filter((k) => list?.items?.some((it) => itemKey(it) === k)).length
    const total = Math.max(planned + pulled, left)
    return { left, total, done: Math.max(0, total - left) }
  }
  const calls = count('calls')
  const files = count('files')
  const partners = count('partners')
  const counts = [
    { key: 'calls', label: 'Calls', done: calls.done, total: calls.total, note: `${callsLogged} logged` },
    { key: 'files', label: 'Files', done: Math.max(files.done, filesDone), total: Math.max(files.total, filesDone + files.left), note: files.left ? `${files.left} rolled` : 'all done' },
    { key: 'partners', label: 'Partners', done: partners.done, total: partners.total, note: partners.total ? `${partners.left} left` : 'none today' },
    { key: 'hard', label: 'Hard dates', done: null, total: hardOpen, note: hardOpen ? 'still open' : 'none open' },
  ]
  const rolled = lists.flatMap((l) => l.items.map((it) => ({ key: itemKey(it), list: LABEL[l.key] || l.key, name: itemName(it) })))
  const theme = tomorrowTheme(now)
  return {
    counts,
    moved,
    gap: { now: gapNow, morning: saved?.wrap?.morning?.gap ?? null },
    rolled,
    tomorrow: { theme: theme?.label || null, weekday: theme?.weekday || null, rolled: rolled.length, first: rolled.slice(0, 2).map((r) => r.name) },
  }
}

// People whose stage changed today, from rows with stage_since (dial rows and
// the work lane's pipeline), once each. valueOf(id) -> { text } or null.
export function movedToday(rows, { now = Date.now(), valueOf = () => null } = {}) {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const seen = new Set()
  const out = []
  for (const r of rows || []) {
    if (!r?.id || seen.has(r.id) || !r.stage_since || Date.parse(r.stage_since) < start.getTime()) continue
    seen.add(r.id)
    out.push({ id: r.id, name: r.name || '(no name)', stage: r.stage || '', value: valueOf(r.id)?.text || null })
  }
  return out
}
