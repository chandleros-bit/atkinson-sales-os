// Today's three work lists (spec 2026-11-22, B2): Calls, Files and Partners.
// No set times: they are worked whenever the day allows. Workbench owns the
// lists; Overview shows their counts from this same function so the two
// pages agree. Pure: callers pass what buildDialList, buildWorkGroups and
// buildThemeList already returned.
//   dial:   { dueNow, laterToday }       (dialList.js)
//   groups: [{ id, items: [{ late }] }]  (workbench.js), 'waiting' is parked
//   theme:  { theme, items, total }       (dialThemes.js)
// -> [{ key, label, sub, count, flagged, items }]

const startOfDay = (now) => {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export const NEW_LEAD_MINUTES = 30

export function workLists({ dial, groups, theme, now = Date.now() }) {
  const dueNow = dial?.dueNow || []
  const later = dial?.laterToday || []
  const calls = [...dueNow, ...later]
  const today = startOfDay(now)
  // A call is flagged when it was due before today; a new lead when it's still fresh.
  const callFlagged = calls.filter((i) => i.dueAt < today).length

  const files = (groups || []).filter((g) => g.id !== 'waiting').flatMap((g) => g.items || [])
  const parked = (groups || []).find((g) => g.id === 'waiting')?.items?.length || 0

  const partners = theme?.items || []
  const partnerFlagged = partners.filter((i) => i.dueAt < today).length

  return [
    {
      key: 'calls',
      label: 'Calls',
      sub: later.length ? `${dueNow.length} due now · ${later.length} later today` : 'Speed to lead first, then follow-ups',
      count: calls.length,
      flagged: callFlagged,
      items: calls,
    },
    {
      key: 'files',
      label: 'Files',
      sub: parked ? `Estimates, applications, MPG work · ${parked} parked` : 'Estimates, applications, MPG work',
      count: files.length,
      flagged: files.filter((i) => i.late).length,
      items: files,
    },
    {
      key: 'partners',
      label: 'Partners',
      sub: theme?.theme ? `Today: ${theme.theme.label.toLowerCase()}` : 'No partner list on weekends',
      count: partners.length,
      flagged: partnerFlagged,
      items: partners,
    },
  ]
}

// The newest uncalled lead under 30 minutes old, for the new-lead strip, or null.
export function freshLead(dial, now = Date.now()) {
  const cutoff = now - NEW_LEAD_MINUTES * 60_000
  const fresh = (dial?.dueNow || []).filter((i) => i.kind === 'attempt' && i.step === 1 && i.dueAt >= cutoff && i.dueAt <= now)
  if (!fresh.length) return null
  return fresh.reduce((a, b) => (b.dueAt > a.dueAt ? b : a))
}
