import { describe, it, expect } from 'vitest'
import {
  BUCKETS,
  DEFAULT_RULES,
  resolveRules,
  humanTouchAt,
  bucketsFor,
  buildQueue,
  groupForDisplay,
  reasonText,
  lastCallLabel,
  urgentCount,
  stuckDaysFor,
} from './priorityQueue'

// Local times (no Z): the queue thinks in the rep's local calendar days.
const NOW = new Date('2026-10-18T09:00:00').getTime()
const daysAgo = (n, hh = '09:00:00') => {
  const d = new Date(NOW)
  d.setDate(d.getDate() - n)
  const p = (x) => String(x).padStart(2, '0')
  return new Date(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${hh}`).toISOString()
}
const rules = { ...DEFAULT_RULES, use_crm_last_activity_fallback: false }

// A lead that fires nothing: old, active-less, touched today, nothing open.
const base = (o = {}) => ({
  id: o.id || 'x',
  business_id: 'bay',
  name: 'Jo Ramirez',
  company: null,
  stage: null,
  stage_since: null,
  is_hot: false,
  is_active: false,
  is_partner: false,
  score: null,
  crm_created_at: daysAgo(400),
  crm_last_activity_at: null,
  last_outbound_at: daysAgo(0, '08:00:00'),
  last_outbound_call_at: daysAgo(0, '08:00:00'),
  last_inbound_at: null,
  open_task_count: 0,
  oldest_open_due_at: null,
  snooze_count_60d: 0,
  ...o,
})

describe('BUCKETS', () => {
  it('ranks reached-out first and gone-quiet last', () => {
    expect(BUCKETS.map((b) => b.id)).toEqual([
      'reached_out', 'new_lead', 'overdue', 'hot_cold', 'no_next_step', 'stuck', 'quiet',
    ])
  })
})

describe('resolveRules', () => {
  it('fills missing keys from the defaults', () => {
    expect(resolveRules({ quiet_days: 10 })).toMatchObject({ quiet_days: 10, hot_cold_days: 3, daily_cap: 15 })
    expect(resolveRules(null)).toEqual(DEFAULT_RULES)
  })
})

describe('bucket 1: they reached out', () => {
  it('fires when the latest inbound call is newer than the latest outbound touch', () => {
    expect(bucketsFor(base({ last_inbound_at: daysAgo(0, '08:30:00') }), rules, NOW)).toContain('reached_out')
  })
  it('does not fire for an inbound call older than the last outbound', () => {
    expect(bucketsFor(base({ last_inbound_at: daysAgo(0, '07:00:00') }), rules, NOW)).not.toContain('reached_out')
  })
  it('ignores the CRM last-activity fallback (it moves on the inbound call itself)', () => {
    const row = base({ last_inbound_at: daysAgo(0, '08:30:00'), crm_last_activity_at: daysAgo(0, '08:45:00') })
    expect(bucketsFor(row, { ...rules, use_crm_last_activity_fallback: true }, NOW)).toContain('reached_out')
  })
})

describe('bucket 2: new, not yet called', () => {
  const fresh = (o) => base({ last_outbound_at: null, last_outbound_call_at: null, crm_created_at: daysAgo(1), ...o })
  it('fires for a lead created within the window with no outbound call', () => {
    expect(bucketsFor(fresh(), rules, NOW)).toContain('new_lead')
    expect(bucketsFor(fresh({ crm_created_at: daysAgo(7) }), rules, NOW)).toContain('new_lead')
  })
  it('does not fire one day past the window', () => {
    expect(bucketsFor(fresh({ crm_created_at: daysAgo(8) }), rules, NOW)).not.toContain('new_lead')
  })
  it('does not fire once an outbound call is logged, even with only a note before', () => {
    expect(bucketsFor(fresh({ last_outbound_call_at: daysAgo(0) }), rules, NOW)).not.toContain('new_lead')
    expect(bucketsFor(fresh({ last_outbound_at: daysAgo(0) }), rules, NOW)).toContain('new_lead')
  })
})

describe('bucket 3: follow-up overdue', () => {
  it('fires for an open task due before today', () => {
    expect(bucketsFor(base({ open_task_count: 1, oldest_open_due_at: daysAgo(1, '17:00:00') }), rules, NOW)).toContain('overdue')
  })
  it('a task due today at 5 PM is not overdue at 9 AM', () => {
    expect(bucketsFor(base({ open_task_count: 1, oldest_open_due_at: daysAgo(0, '17:00:00') }), rules, NOW)).not.toContain('overdue')
  })
  it('reads a date-only due (midnight UTC) as that calendar day', () => {
    expect(bucketsFor(base({ open_task_count: 1, oldest_open_due_at: '2026-10-18T00:00:00+00:00' }), rules, NOW)).not.toContain('overdue')
    expect(bucketsFor(base({ open_task_count: 1, oldest_open_due_at: '2026-10-17T00:00:00+00:00' }), rules, NOW)).toContain('overdue')
  })
})

describe('bucket 4: hot, going cold', () => {
  it('fires for a hot lead with no touch in hot_cold_days', () => {
    expect(bucketsFor(base({ is_hot: true, last_outbound_at: daysAgo(3), last_outbound_call_at: daysAgo(3) }), rules, NOW)).toContain('hot_cold')
    expect(bucketsFor(base({ is_hot: true, last_outbound_at: null, last_outbound_call_at: null }), rules, NOW)).toContain('hot_cold')
  })
  it('does not fire one day short', () => {
    expect(bucketsFor(base({ is_hot: true, last_outbound_at: daysAgo(2), last_outbound_call_at: daysAgo(2) }), rules, NOW)).not.toContain('hot_cold')
  })
  it('does not fire for a lead that is not hot', () => {
    expect(bucketsFor(base({ last_outbound_at: daysAgo(10) }), rules, NOW)).not.toContain('hot_cold')
  })
})

describe('bucket 5: no next step', () => {
  it('fires for an active lead with no open task', () => {
    expect(bucketsFor(base({ is_active: true, stage: 'Waiting on Docs' }), rules, NOW)).toContain('no_next_step')
  })
  it('does not fire once any task is open, or for an inactive lead', () => {
    expect(bucketsFor(base({ is_active: true, stage: 'Waiting on Docs', open_task_count: 1, oldest_open_due_at: daysAgo(-2) }), rules, NOW)).not.toContain('no_next_step')
    expect(bucketsFor(base({ is_active: false }), rules, NOW)).not.toContain('no_next_step')
  })
})

describe('bucket 6: stuck in stage', () => {
  it('fires after stuck_days in the same stage', () => {
    expect(bucketsFor(base({ is_active: true, stage: 'App Sent', stage_since: daysAgo(14), open_task_count: 1, oldest_open_due_at: daysAgo(-1) }), rules, NOW)).toContain('stuck')
  })
  it('does not fire one day short', () => {
    expect(bucketsFor(base({ is_active: true, stage: 'App Sent', stage_since: daysAgo(13) }), rules, NOW)).not.toContain('stuck')
  })
  it('never fires without an observed stage start', () => {
    expect(bucketsFor(base({ is_active: true, stage: 'App Sent', stage_since: null }), rules, NOW)).not.toContain('stuck')
  })
  it('uses the per-stage limit: Attempted is stuck at 5 days', () => {
    const lead = (n) => base({ is_active: true, stage: 'Attempted', stage_since: daysAgo(n), open_task_count: 1, oldest_open_due_at: daysAgo(-1) })
    expect(bucketsFor(lead(5), rules, NOW)).toContain('stuck')
    expect(bucketsFor(lead(4), rules, NOW)).not.toContain('stuck')
  })
})

describe('bucket 7: gone quiet', () => {
  it('fires for an active lead with no touch in quiet_days', () => {
    expect(bucketsFor(base({ is_active: true, stage: 'New Lead', last_outbound_at: daysAgo(7), last_outbound_call_at: daysAgo(7) }), rules, NOW)).toContain('quiet')
  })
  it('does not fire one day short', () => {
    expect(bucketsFor(base({ is_active: true, stage: 'New Lead', last_outbound_at: daysAgo(6), last_outbound_call_at: daysAgo(6) }), rules, NOW)).not.toContain('quiet')
  })
})

describe('human touch and the CRM fallback', () => {
  const quietRow = base({ is_active: true, stage: 'New Lead', last_outbound_at: daysAgo(20), last_outbound_call_at: daysAgo(20), crm_last_activity_at: daysAgo(1) })
  it('ignores crm_last_activity_at with the fallback off', () => {
    expect(humanTouchAt(quietRow, rules)).toBe(daysAgo(20))
    expect(bucketsFor(quietRow, rules, NOW)).toContain('quiet')
  })
  it('counts crm_last_activity_at as a touch with the fallback on', () => {
    const on = { ...rules, use_crm_last_activity_fallback: true }
    expect(humanTouchAt(quietRow, on)).toBe(daysAgo(1))
    expect(bucketsFor(quietRow, on, NOW)).not.toContain('quiet')
  })
  it('counts an inbound call as a touch', () => {
    expect(humanTouchAt(base({ last_outbound_at: daysAgo(9), last_inbound_at: daysAgo(2) }), rules)).toBe(daysAgo(2))
  })
})

describe('partners and exclusions', () => {
  it('a partner (realtor) only ever lands in "reached out"', () => {
    const partner = base({ is_partner: true, is_hot: true, last_outbound_at: null, last_outbound_call_at: null, crm_created_at: daysAgo(1), open_task_count: 1, oldest_open_due_at: daysAgo(3) })
    expect(bucketsFor(partner, rules, NOW)).toEqual([])
    expect(bucketsFor({ ...partner, last_inbound_at: daysAgo(0) }, rules, NOW)).toEqual(['reached_out'])
  })
  it('a Nurture or lost lead never appears, even if overdue', () => {
    const overdue = { open_task_count: 1, oldest_open_due_at: daysAgo(5) }
    expect(buildQueue([base({ id: 'n', stage: 'Nurture', ...overdue }), base({ id: 'l', stage: 'Lost - rate shopping', ...overdue })], rules, NOW)).toEqual([])
  })
})

describe('buildQueue', () => {
  it('shows a lead once, under its highest bucket, with the rest as chips', () => {
    const [row] = buildQueue([base({ is_active: true, stage: 'Waiting on Docs', open_task_count: 1, oldest_open_due_at: daysAgo(2) })], rules, NOW)
    expect(row.bucket).toBe('overdue')
    // 'no_next_step' needs zero open tasks, so add an unrelated second reason:
    const [hot] = buildQueue([base({ is_hot: true, is_active: true, stage: 'New Lead', last_outbound_at: daysAgo(9), last_outbound_call_at: daysAgo(9), open_task_count: 1, oldest_open_due_at: daysAgo(2) })], rules, NOW)
    expect(hot.bucket).toBe('overdue')
    expect(hot.reasons).toEqual(['overdue', 'hot_cold', 'quiet'])
  })

  it('orders buckets by rank, oldest neglect first inside a bucket', () => {
    const q = buildQueue([
      base({ id: 'quiet-old', is_active: true, stage: 'New Lead', last_outbound_at: daysAgo(30), last_outbound_call_at: daysAgo(30), open_task_count: 1, oldest_open_due_at: daysAgo(-3) }),
      base({ id: 'overdue-1', open_task_count: 1, oldest_open_due_at: daysAgo(1) }),
      base({ id: 'overdue-5', open_task_count: 1, oldest_open_due_at: daysAgo(5) }),
      base({ id: 'reached', last_inbound_at: daysAgo(0, '08:30:00') }),
    ], rules, NOW)
    expect(q.map((r) => r.id)).toEqual(['reached', 'overdue-5', 'overdue-1', 'quiet-old'])
  })

  it('sorts new leads newest first', () => {
    const fresh = (id, d) => base({ id, last_outbound_at: null, last_outbound_call_at: null, crm_created_at: d })
    const q = buildQueue([fresh('older', daysAgo(3)), fresh('newest', daysAgo(0, '07:00:00')), fresh('mid', daysAgo(1))], rules, NOW)
    expect(q.map((r) => r.id)).toEqual(['newest', 'mid', 'older'])
  })

  it('breaks ties on score, then name', () => {
    const od = { open_task_count: 1, oldest_open_due_at: daysAgo(2) }
    const q = buildQueue([
      base({ id: 'b', name: 'Bea', score: 40, ...od }),
      base({ id: 'a', name: 'Al', score: 40, ...od }),
      base({ id: 'top', name: 'Zed', score: 90, ...od }),
    ], rules, NOW)
    expect(q.map((r) => r.id)).toEqual(['top', 'a', 'b'])
  })

  it('adds the Decide chip at 3 snoozes in 60 days', () => {
    const od = { open_task_count: 1, oldest_open_due_at: daysAgo(2) }
    expect(buildQueue([base({ ...od, snooze_count_60d: 3 })], rules, NOW)[0].decide).toBe(true)
    expect(buildQueue([base({ ...od, snooze_count_60d: 2 })], rules, NOW)[0].decide).toBe(false)
  })
})

describe('groupForDisplay / urgentCount', () => {
  const od = (id, n) => base({ id, open_task_count: 1, oldest_open_due_at: daysAgo(n) })
  const q = buildQueue([
    base({ id: 'r', last_inbound_at: daysAgo(0, '08:30:00') }),
    od('o1', 1), od('o2', 2),
    base({ id: 'q', is_active: true, stage: 'New Lead', last_outbound_at: daysAgo(9), last_outbound_call_at: daysAgo(9), open_task_count: 1, oldest_open_due_at: daysAgo(-1) }),
  ], rules, NOW)

  it('caps the visible rows and groups them by bucket', () => {
    const g = groupForDisplay(q, 2)
    expect(g.visible.map((r) => r.id)).toEqual(['r', 'o2'])
    expect(g.hiddenCount).toBe(2)
    expect(g.counts).toEqual({ reached_out: 1, overdue: 2, quiet: 1 })
    expect(g.groups.map((x) => [x.id, x.rows.map((r) => r.id)])).toEqual([['reached_out', ['r']], ['overdue', ['o2']]])
  })
  it('counts buckets 1 to 3 as urgent', () => {
    expect(urgentCount(q)).toBe(3)
  })
})

describe('reasonText / lastCallLabel', () => {
  it('counts a new lead in minutes for its first hour', () => {
    expect(reasonText({ ...base({ crm_created_at: daysAgo(0, '08:48:00') }), bucket: 'new_lead' }, NOW)).toBe('New lead · 12m, not called')
    expect(reasonText({ ...base({ crm_created_at: daysAgo(0, '07:30:00') }), bucket: 'new_lead' }, NOW)).toBe('New lead · 2 hours, not called')
  })
  it('reads like plain words', () => {
    expect(reasonText({ ...base({ last_inbound_at: daysAgo(0, '07:00:00') }), bucket: 'reached_out' }, NOW)).toBe('Called you 2h ago, no callback')
    expect(reasonText({ ...base({ crm_created_at: daysAgo(1, '07:00:00') }), bucket: 'new_lead' }, NOW)).toBe('New lead · 26 hours, not called')
    expect(reasonText({ ...base({ crm_created_at: daysAgo(4) }), bucket: 'new_lead' }, NOW)).toBe('New lead · 4 days, not called')
    expect(reasonText({ ...base({ oldest_open_due_at: daysAgo(1) }), bucket: 'overdue' }, NOW)).toBe('Follow-up 1 day overdue')
    expect(reasonText({ ...base({ oldest_open_due_at: daysAgo(3) }), bucket: 'overdue' }, NOW)).toBe('Follow-up 3 days overdue')
    expect(reasonText({ ...base({ last_outbound_at: daysAgo(5) }), bucket: 'hot_cold', touchAt: daysAgo(5) }, NOW)).toBe('HOT · 5 days since last touch')
    expect(reasonText({ ...base(), bucket: 'hot_cold', touchAt: null }, NOW)).toBe('HOT · no touch logged')
    expect(reasonText({ ...base({ stage: 'Waiting on Docs' }), bucket: 'no_next_step' }, NOW)).toBe('Waiting on Docs · no next step')
    expect(reasonText({ ...base({ stage: 'App Sent', stage_since: daysAgo(18) }), bucket: 'stuck' }, NOW)).toBe('In App Sent for 18 days')
    expect(reasonText({ ...base(), bucket: 'quiet', touchAt: daysAgo(9) }, NOW)).toBe('9 days since last touch')
  })
  it('labels the last call', () => {
    expect(lastCallLabel(base({ last_outbound_call_at: daysAgo(9) }), NOW)).toBe('Last call 9d ago')
    expect(lastCallLabel(base({ last_outbound_call_at: daysAgo(0, '08:00:00') }), NOW)).toBe('Last call today')
    expect(lastCallLabel(base({ last_outbound_call_at: null }), NOW)).toBe('No calls logged')
  })
})

describe('stuckDaysFor', () => {
  it('reads the per-stage limit, null for never, else the flat stuck_days', () => {
    expect(stuckDaysFor('New Lead', rules)).toBe(2)
    expect(stuckDaysFor('Attempted', rules)).toBe(5)
    expect(stuckDaysFor('Application Received', rules)).toBe(14)
    expect(stuckDaysFor('Nurture / Credit Repair', rules)).toBeNull()
    expect(stuckDaysFor('Open', rules)).toBe(14)
    expect(stuckDaysFor('Open', { ...rules, stuck_days_by_stage: undefined })).toBe(14)
  })
})
