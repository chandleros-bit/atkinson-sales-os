// Workbench Work lane: the day's file work, from CRM state only (slice 2).
// Pure, no React, no I/O. Spec: docs/superpowers/specs/2026-10-22-workbench-design.md
//
//   Estimates to Work (Bayway)        leads in Contacted/Working (tag Working Estimate)
//   Applications to Review (Bayway)   leads in Application Received
//   Statement/Proposal Review (MPG)   open Zoho tasks
import { nextStep, stuckFor } from './cardHealth'
import { calendarDaysSince, overdueDays } from './priorityQueue'
import { dueLabel } from './tasks'

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const time = (iso) => (iso ? new Date(iso).getTime() : Infinity)
// Oldest stage start first; an unknown start goes last.
const byStageSince = (a, b) => time(a.stage_since) - time(b.stage_since)

function estimateItem(row, rules, now) {
  const next = nextStep(row, now)
  const days = calendarDaysSince(row.stage_since, now)
  const overdue = next.state === 'overdue'
  return {
    key: `estimate:${row.id}`,
    kind: 'estimate',
    contactId: row.id,
    name: row.name || '(no name)',
    title: 'Work estimate',
    why: overdue ? next.text : days == null ? `In ${row.stage}` : `Working ${plural(days, 'day')}`,
    late: overdue || !!stuckFor(row, rules, now),
  }
}

function applicationItem(row, rules, now) {
  const docs = row.docs_outstanding_count || 0
  const days = calendarDaysSince(row.stage_since, now)
  return {
    key: `application:${row.id}`,
    kind: 'application',
    contactId: row.id,
    name: row.name || '(no name)',
    title: 'Review application',
    why: docs > 0 ? `${plural(docs, 'doc')} missing` : days == null ? `In ${row.stage}` : `In ${row.stage} ${plural(days, 'day')}`,
    late: docs > 0 || !!stuckFor(row, rules, now),
  }
}

function mpgTaskItem(task, now) {
  const late = task.due_at ? overdueDays(task.due_at, now) : null
  return {
    key: `mpg_task:${task.id}`,
    kind: 'mpg_task',
    taskId: task.id,
    contactId: task.contact_id || null,
    name: [task.company, task.contact_name].filter(Boolean).join(' · ') || '(no lead)',
    title: task.title || 'Zoho task',
    why: late == null ? 'No due date' : late >= 1 ? `Due ${plural(late, 'day')} ago` : late === 0 ? 'Due today' : `Due ${dueLabel(task.due_at, now)}`,
    late: late != null && late >= 1,
  }
}

// pipeline: v_active_pipeline rows (Bayway). mpgTasks: open v_tasks rows for MPG.
export function buildWorkGroups({ pipeline = [], mpgTasks = [], rules, now = Date.now() }) {
  const inStage = (stage) => pipeline.filter((r) => r.stage === stage)
  const estimates = inStage('Contacted/Working').sort(byStageSince).map((r) => estimateItem(r, rules, now))
  const applications = inStage('Application Received')
    .sort((a, b) => (b.docs_outstanding_count || 0) - (a.docs_outstanding_count || 0) || byStageSince(a, b))
    .map((r) => applicationItem(r, rules, now))
  const statements = [...mpgTasks].sort((a, b) => time(a.due_at) - time(b.due_at)).map((t) => mpgTaskItem(t, now))
  return [
    { id: 'estimates', title: 'Estimates to Work', book: 'bay', items: estimates },
    { id: 'applications', title: 'Applications to Review', book: 'bay', items: applications },
    { id: 'statements', title: 'Statement/Proposal Review', book: 'mpg', items: statements },
  ]
}
