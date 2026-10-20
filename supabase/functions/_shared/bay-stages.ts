// Bayway pipeline stages, carried in FollowUpBoss TAGS (person stages can only
// be edited by the FUB account owner). Chandler's Smart Lists 01–09 filter on
// these same tags, so the dashboard reads and writes them rather than its own.
// See docs/superpowers/specs/2026-10-19-bayway-stage-tags-design.md.
//
// Shared by the crm-action function (Move stage) and the browser (board order,
// Move stage menu). The READ rule is mirrored in SQL derive_stage() (migration
// 0031); keep the two in step.

export const BAY_STAGES = [
  'New Lead',
  'Attempted',
  'Contacted/Working',
  'Application/Estimate Sent',
  'Application Received',
  // Parked leads (Smart List 11). Last on the board; the name contains
  // "Nurture", so Up Next leaves these leads alone.
  'Nurture / Credit Repair',
]
const PARKED = 'Nurture / Credit Repair'
// Marked lost from the board (tag `Lost`). Not a column: v_active_pipeline
// leaves these leads out, and Up Next skips the "Lost" stage name.
export const LOST = 'Lost'

// Workflow tags by column (lowercase). Furthest column wins.
const STAGE_TAGS = {
  Attempted: ['attempted'],
  'Contacted/Working': ['working estimate'],
  'Application/Estimate Sent': ['estimate sent', 'application sent'],
  'Application Received': ['application received', 'need docs', 'under contract'],
  'Nurture / Credit Repair': ['credit repair'],
  [LOST]: ['lost'],
}
const WORKFLOW = new Set(Object.values(STAGE_TAGS).flat())
const ON_BOARD = new Set(['lead', 'pre-qualified'])

const norm = (t) => String(t ?? '').trim().toLowerCase()

// The column a lead belongs in, or null when it is off the board.
export function bayStageFromTags(tags, personStage) {
  const ps = norm(personStage)
  if (!ON_BOARD.has(ps)) return null
  const have = new Set((Array.isArray(tags) ? tags : []).map(norm))
  // Lost beats everything, parked included.
  if (STAGE_TAGS[LOST].some((t) => have.has(t))) return LOST
  // A parked lead stays parked whatever else it is tagged with.
  if (STAGE_TAGS[PARKED].some((t) => have.has(t))) return PARKED
  if (ps === 'pre-qualified') return 'Application Received'
  for (let i = BAY_STAGES.indexOf(PARKED) - 1; i > 0; i--) {
    const stage = BAY_STAGES[i]
    if (STAGE_TAGS[stage].some((t) => have.has(t))) return stage
  }
  return 'New Lead'
}

// Move stage targets. `tag` is what gets added (in Chandler's casing); `keep`
// are tags that already satisfy the target and are left as they are.
export const STAGE_TARGETS = [
  { key: 'new_lead', label: 'New Lead', stage: 'New Lead', tag: null, keep: [] },
  { key: 'attempted', label: 'Attempted', stage: 'Attempted', tag: 'attempted', keep: ['attempted'] },
  { key: 'working', label: 'Contacted/Working', stage: 'Contacted/Working', tag: 'Working Estimate', keep: ['working estimate'] },
  { key: 'estimate_sent', label: 'Estimate Sent', stage: 'Application/Estimate Sent', tag: 'estimate sent', keep: ['estimate sent'] },
  { key: 'application_sent', label: 'Application Sent', stage: 'Application/Estimate Sent', tag: 'application sent', keep: ['application sent'] },
  {
    key: 'application_received',
    label: 'Application Received',
    stage: 'Application Received',
    tag: 'application received',
    keep: ['application received', 'need docs', 'under contract'],
  },
  { key: 'credit_repair', label: 'Nurture / Credit Repair', stage: PARKED, tag: 'Credit Repair', keep: ['credit repair'] },
  { key: 'lost', label: 'Lost', stage: LOST, tag: 'Lost', keep: ['lost'] },
]
const TARGET = Object.fromEntries(STAGE_TARGETS.map((t) => [t.key, t]))

// New full tag list for a Move stage: drop workflow tags that don't belong to
// the target, keep everything else, add the target tag if nothing already
// satisfies it. FUB's PUT /people replaces the whole list, hence a full list.
export function retagForTarget(tags, targetKey) {
  const target = TARGET[targetKey]
  if (!target) throw new Error(`Unknown stage target: ${targetKey}`)
  const list = Array.isArray(tags) ? tags : []
  const kept = list.filter((t) => !WORKFLOW.has(norm(t)) || target.keep.includes(norm(t)))
  if (target.tag && !kept.some((t) => target.keep.includes(norm(t)))) kept.push(target.tag)
  return kept
}

// The Move stage target that matches where a lead is now (for highlighting).
export function targetForStage(tags, personStage) {
  const stage = bayStageFromTags(tags, personStage)
  if (stage === 'Application/Estimate Sent') {
    return (Array.isArray(tags) ? tags : []).map(norm).includes('application sent') ? 'application_sent' : 'estimate_sent'
  }
  if (!stage) return null
  return STAGE_TARGETS.find((t) => t.stage === stage)?.key ?? null
}
