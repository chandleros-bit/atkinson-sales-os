// Pure helpers for the Overview (Command Center) screen.
// No React, no I/O — everything here is unit-testable.
// Spec: docs/superpowers/specs/2026-07-09-phase3-overview-design.md
import { bucketByDue } from './tasks'

export const NEW_LEAD = 'New Lead'
export const STALE_TOUCH_DAYS = 7
export const SYNC_STALE_MINUTES = 45

const DAY_MS = 86_400_000

// Bayway "Needs Attention" surfaces contacts tagged HOT in FollowUpBoss. Tags
// live in contacts.raw.tags (a string array); match "hot" case-insensitively.
export function isHot(tags) {
  return Array.isArray(tags) && tags.some((t) => String(t).trim().toLowerCase() === 'hot')
}

// MPG "Needs Attention" surfaces leads whose Zoho Lead_Status (our stage) is
// Open. Matched case-insensitively so a casing change in Zoho stays safe.
export function isMpgOpen(stage) {
  return String(stage || '').trim().toLowerCase() === 'open'
}

export function daysSince(iso, now = Date.now()) {
  if (!iso) return null
  return Math.floor((now - new Date(iso).getTime()) / DAY_MS)
}

export function lastTouchLabel(iso, now = Date.now()) {
  const d = daysSince(iso, now)
  if (d === null) return '—'
  if (d < 1) return 'today'
  return `${d}d ago`
}

// Unknown touch first (assume it needs attention most), then oldest to newest.
export function sortByAttention(rows) {
  return [...rows].sort((a, b) => {
    if (!a.last_touch_at && !b.last_touch_at) return 0
    if (!a.last_touch_at) return -1
    if (!b.last_touch_at) return 1
    return new Date(a.last_touch_at) - new Date(b.last_touch_at)
  })
}

// rows: v_active_pipeline rows. totalContacts: count of the contacts table.
export function buildKpis(rows, totalContacts) {
  const counts = new Map()
  for (const r of rows) counts.set(r.stage, (counts.get(r.stage) || 0) + 1)
  const stageCards = [...counts.entries()]
    .filter(([stage]) => stage !== NEW_LEAD)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 2)
    .map(([label, count]) => ({ label, count }))
  return {
    activeLoans: rows.filter((r) => r.stage !== NEW_LEAD).length,
    stageCards,
    newLeads: counts.get(NEW_LEAD) || 0,
    nurture: Math.max(0, totalContacts - rows.length),
  }
}

// Combined "All" command-center KPIs: one figure per business plus the total.
// bayRows: v_active_pipeline rows (business_id 'bay'). mpgRows: v_mpg_contacts
// leads. bayContacts / mpgContacts: total contact counts per book. Every MPG
// lead counts as in-pipeline (the MPG book lives on leads today, 0 deals).
export function buildCombinedKpis(bayRows, mpgRows, bayContacts, mpgContacts, now = Date.now()) {
  const isStale = (r) => {
    const d = daysSince(r.last_touch_at, now)
    return d === null || d >= STALE_TOUCH_DAYS
  }
  const split = (mpg, bay) => ({ mpg, bay, total: mpg + bay })
  return {
    pipeline: split(mpgRows.length, bayRows.length),
    attention: split(mpgRows.filter(isStale).length, bayRows.filter(isStale).length),
    contacts: split(mpgContacts, bayContacts),
    nurture: split(
      Math.max(0, mpgContacts - mpgRows.length),
      Math.max(0, bayContacts - bayRows.length),
    ),
  }
}

// latestSync: newest sync_log row for source 'fub' (or null if none).
// tasks: v_tasks rows, already filtered to the business being viewed.
// Returns { level: 'red'|'amber', text } or null. Red wins over amber.
//
// Red is reserved for "the system is broken" (sync down); amber means "you have
// work". Keeping that split is why a backlog of tasks never masks a dead sync.
export function deriveAlert({ latestSync, tasks, now = Date.now() }) {
  if (!latestSync) {
    return { level: 'red', text: 'FollowUpBoss has never synced — check the Sync Status screen.' }
  }
  if (latestSync.status === 'error') {
    return { level: 'red', text: `FollowUpBoss sync failed: ${latestSync.message || 'unknown error'}` }
  }
  const ageMin = Math.floor((now - new Date(latestSync.ran_at).getTime()) / 60_000)
  if (ageMin > SYNC_STALE_MINUTES) {
    return {
      level: 'red',
      text: `FollowUpBoss last synced ${ageMin} minutes ago — the 15-minute schedule may be stuck.`,
    }
  }
  // What's actually actionable right now. Reuses bucketByDue so the banner and
  // the Tasks screen can never disagree about what "overdue" or "today" means —
  // including the date-only handling for CRM due dates that land on midnight UTC.
  const buckets = bucketByDue(tasks || [], now)
  const count = (key) => buckets.find((b) => b.key === key)?.rows.length || 0
  const overdue = count('overdue')
  const today = count('today')

  if (overdue && today) {
    return {
      level: 'amber',
      text: `${overdue} task${overdue === 1 ? '' : 's'} overdue · ${today} due today`,
    }
  }
  if (overdue) {
    return { level: 'amber', text: `${overdue} task${overdue === 1 ? '' : 's'} overdue` }
  }
  if (today) {
    return { level: 'amber', text: `${today} task${today === 1 ? '' : 's'} due today` }
  }
  return null
}
