// Yesterday's numbers for the daily briefing. callConnected mirrors the SQL
// public.call_connected (migration 0049); keep the two in sync.
const CONNECT_OUTCOMES = new Set(['Interested', 'Not Interested'])
const ZOHO_RESULTS = new Set(['Interested', 'Not interested'])
const ZOHO_SUBJECTS = new Set(['Call: Interested', 'Call: Not Interested'])

export function callConnected(raw) {
  if (!raw) return false
  if (CONNECT_OUTCOMES.has(raw.outcome ?? '')) return true
  if (ZOHO_RESULTS.has(raw.Call_Result ?? '')) return true
  if (ZOHO_SUBJECTS.has(raw.Subject ?? '')) return true
  const d = String(raw.duration ?? '')
  if (/^\d+$/.test(d) && Number(d) >= 120) return true
  const m = /^(\d+):(\d{2})$/.exec(String(raw.Call_Duration ?? ''))
  if (m && Number(m[1]) * 60 + Number(m[2]) >= 120) return true
  return false
}

// activities: yesterday's activities ({ type, direction, raw });
// newApplications: board rows that entered Application Received yesterday.
export function yesterdayScorecard({ activities = [], newApplications = [] }) {
  const out = activities.filter((a) => a.direction === 'outbound')
  const calls = out.filter((a) => a.type === 'call')
  return {
    calls: calls.length,
    connects: calls.filter((a) => callConnected(a.raw)).length,
    texts: out.filter((a) => a.type === 'text').length,
    applications: newApplications.length,
  }
}

// "Need N per business day" for a goal that's behind; null when hit or untargeted.
export function needPerDay(goal, daysLeft) {
  const target = Number(goal?.target || 0)
  const value = Number(goal?.value || 0)
  if (!target || value >= target) return null
  return Math.ceil((target - value) / Math.max(1, daysLeft))
}
