// Pure search/filter/sort helpers for the Bayway Contacts table.
// No React, no I/O — unit-testable.
// Spec: docs/superpowers/specs/2026-07-11-phase6-bayway-contacts-design.md

export const NURTURE = 'Nurture'

// rows: v_bayway_contacts rows. Returns a new filtered array (non-mutating).
export function filterContacts(rows, { query, stageFilter }) {
  const q = (query || '').trim().toLowerCase()
  return rows.filter((r) => {
    if (stageFilter === 'active' && r.stage === NURTURE) return false
    if (stageFilter === 'nurture' && r.stage !== NURTURE) return false
    if (!q) return true
    const hay = `${r.name || ''} ${r.email || ''} ${r.phone || ''}`.toLowerCase()
    return hay.includes(q)
  })
}

// key: 'name' | 'stage' | 'last_touch_at'. dir: 'asc' | 'desc'.
// Returns a new sorted array (non-mutating). last_touch_at nulls always last.
export function sortContacts(rows, { key, dir }) {
  const factor = dir === 'desc' ? -1 : 1
  return [...rows].sort((a, b) => {
    if (key === 'last_touch_at') {
      const av = a.last_touch_at
      const bv = b.last_touch_at
      if (!av && !bv) return 0
      if (!av) return 1 // nulls last regardless of dir
      if (!bv) return -1
      return (new Date(av) - new Date(bv)) * factor
    }
    const av = (a[key] || '').toString().toLowerCase()
    const bv = (b[key] || '').toString().toLowerCase()
    return av.localeCompare(bv) * factor
  })
}
