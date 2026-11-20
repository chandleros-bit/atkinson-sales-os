// Weekly focus (Bayway Bot Engine doc, Sales OS item 5): the Growth bot marks
// one work item per week as the focus, plus 3 tasks, and logs a Friday
// check-in. Overview shows them. Rows are ordinary custom work_items with
// focus_week (that week's Monday) and focus_role ('focus' | 'task').
import { supabase, isDemoMode } from './supabase'
import { chicagoDateKey } from './briefingTime'

// This week's Monday in Chicago time, as YYYY-MM-DD.
export function focusWeekKey(now = Date.now()) {
  const today = chicagoDateKey(now)
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay() // 0 Sun .. 6 Sat
  return chicagoDateKey(now, -((dow + 6) % 7))
}

// rows -> { focus, tasks: [...], done, total }
export function shapeFocus(rows) {
  const list = rows || []
  const focus = list.find((r) => r.focus_role === 'focus') || null
  const tasks = list
    .filter((r) => r.focus_role === 'task')
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
  return { focus, tasks, done: tasks.filter((t) => t.status === 'done').length, total: tasks.length }
}

export async function loadWeeklyFocus(now = Date.now()) {
  const week = focusWeekKey(now)
  if (isDemoMode) return { week, ...shapeFocus([]), checkin: null }
  const [items, checkin] = await Promise.all([
    supabase.from('work_items').select('id, title, notes, status, due_on, focus_role, business_id, created_at').eq('focus_week', week).limit(20),
    supabase.from('growth_checkins').select('done, total, note').eq('week_start', week).limit(1),
  ])
  if (items.error) throw items.error
  return { week, ...shapeFocus(items.data), checkin: checkin.data?.[0] || null }
}

export async function setFocusTaskDone(id, done) {
  const body = done ? { status: 'done', done_at: new Date().toISOString() } : { status: 'open', done_at: null }
  const { error } = await supabase.from('work_items').update(body).eq('id', id)
  if (error) throw error
  return body
}
