// MPG pipeline stages, carried in Zoho's Lead Status. Zoho stays the source of
// truth: the dashboard reads Lead_Status (zoho.ts mapContact normalizes it to
// one of the labels below) and Move stage writes it back.
//
// Shared by crm-action (Move stage) and the browser (board order, Move stage
// menu, contact card). The READ rule is mirrored in SQL public.mpg_stage()
// (migration 0064); keep the two in step.

// Board order. `status` is the exact Zoho Lead_Status value written on a move
// (Zoho's Standard layout picklist); `aliases` are other Lead_Status values
// (lowercase) that read as this stage, so older statuses land in a column.
export const MPG_STAGE_TARGETS = [
  { key: 'not_contacted', label: 'Not Contacted', status: 'Not Contacted', aliases: [] },
  // Attempted: called, not reached yet.
  {
    key: 'follow_up',
    label: 'Initial Lead Follow Up',
    status: 'Initial lead follow up',
    aliases: ['attempted to contact', 'follow up', 'reschedule'],
  },
  // In contact, working on the proposal.
  { key: 'open', label: 'Open', status: 'Open', aliases: ['contacted', 'contact in future', 'pre-qualified', 'qualified'] },
  {
    key: 'submitted',
    label: 'Submitted',
    status: 'Submitted',
    aliases: ['application complete', 'pending', 'conditional approval', 'mpa pending follow up', 'mpa conditional approval follow up', 'mpa no response follow up'],
  },
  { key: 'approved', label: 'Approved', status: 'Approved', aliases: [] },
  { key: 'closed_non_compatible', label: 'Closed Non-Compatible', status: 'Closed non-compatible', aliases: ['declined', 'closed lost'] },
  { key: 'nurture', label: 'Nurture', status: 'Nurture', aliases: [] },
]

export const MPG_STAGES = MPG_STAGE_TARGETS.map((t) => t.label)
export const MPG_NOT_CONTACTED = 'Not Contacted'
export const MPG_FOLLOW_UP = 'Initial Lead Follow Up'
export const MPG_OPEN = 'Open'
export const MPG_SUBMITTED = 'Submitted'
export const MPG_APPROVED = 'Approved'
export const MPG_CLOSED = 'Closed Non-Compatible'
export const MPG_NURTURE = 'Nurture'

const norm = (s) => String(s ?? '').trim().toLowerCase()
const BY_STATUS = new Map()
for (const t of MPG_STAGE_TARGETS) {
  BY_STATUS.set(norm(t.status), t)
  BY_STATUS.set(norm(t.label), t)
  for (const a of t.aliases) BY_STATUS.set(a, t)
}
const BY_KEY = Object.fromEntries(MPG_STAGE_TARGETS.map((t) => [t.key, t]))

// The board label for a Zoho Lead_Status. Unknown statuses (including
// "Initial lead", which is kept out of the OS) come back trimmed, as they are.
export function mpgStageFromStatus(status) {
  if (status == null) return null
  const s = String(status).trim()
  if (!s) return null
  return BY_STATUS.get(norm(s))?.label ?? s
}

export const isMpgStageTarget = (key) => Object.hasOwn(BY_KEY, key)
export const mpgTarget = (key) => BY_KEY[key] || null

// The Move stage target a lead is in now (for highlighting and Undo).
export function mpgTargetForStatus(status) {
  return BY_STATUS.get(norm(status))?.key ?? null
}
