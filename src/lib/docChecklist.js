// The Docs editor's rows and header (spec 2026-11-05-docs-in-os-design.md).
// Pure: rows are borrower_docs rows (active only) for one file.
import { CHASE_DAYS } from './assistantBriefing'
import { daysSince } from './overview'

export const MAX_DOC_NAME = 60

const shortDate = (iso) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' }).format(new Date(iso))
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || null

export function docRows(rows, now = Date.now()) {
  const needed = rows
    .filter((r) => r.status === 'needed')
    .sort((a, b) => String(a.first_requested_at || '').localeCompare(String(b.first_requested_at || '')) || a.doc_type.localeCompare(b.doc_type))
    .map((r) => {
      const days = daysSince(r.first_requested_at, now)
      return { id: r.id, name: r.doc_type, status: 'needed', days, chase: days !== null && days >= CHASE_DAYS, label: days !== null ? `${days}d` : '' }
    })
  const received = rows
    .filter((r) => r.status === 'received')
    .sort((a, b) => String(b.received_at || '').localeCompare(String(a.received_at || '')))
    .map((r) => ({
      id: r.id,
      name: r.doc_type,
      status: 'received',
      days: null,
      chase: false,
      label: [r.received_at ? shortDate(r.received_at) : null, firstName(r.received_by_name)].filter(Boolean).join(' · '),
    }))
  return needed.concat(received)
}

export function docSummary(rows, now = Date.now()) {
  const all = docRows(rows, now)
  const needed = all.filter((r) => r.status === 'needed')
  return { needed: needed.length, total: all.length, oldestDays: needed.length ? Math.max(...needed.map((r) => r.days ?? 0)) : null }
}

export function cleanDocName(s) {
  const t = String(s ?? '').trim()
  return t && t.length <= MAX_DOC_NAME ? t : null
}
