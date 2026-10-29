// Workbench Work lane: the day's file work, from CRM state plus the app's own
// work_items rows (migration 0041). Pure, no React, no I/O.
// Spec: docs/superpowers/specs/2026-10-22-workbench-design.md
//
//   Estimates to Work (Bayway)        leads in Contacted/Working (tag Working Estimate)
//   Applications to Review (Bayway)   leads in Application Received, until
//                                     Review complete tags them Pre-Approved
//                                     or moves them to Disclosed in FUB
//   Disclosed (Bayway)                leads in Disclosed, tracked to closing
//                                     (until an Under Contract pipeline exists)
//   Statement/Proposal Review (MPG)   open Zoho tasks about statements or a
//                                     proposal, plus your own MPG work items
//   Other work                        your own Bayway "+ Work item" rows
//   Waiting on others                 anything parked as Waiting until its check-back day
//
// A work_items row adds status, waiting on, check back and notes to the item
// with the same key (source_key). Done hides an item: an estimate until the
// lead re-enters the stage; an application for 3 days, or until its missing
// docs change or the lead re-enters the stage; an MPG task for good (the Zoho
// task is closed anyway).
//
// Every item carries a rough time (minutes) for planning the day.
import { nextStep, stuckFor } from './cardHealth'
import { calendarDaysSince, overdueDays } from './priorityQueue'
import { dayKey } from './calendar'
import { dueLabel } from './tasks'
import { REVIEWED_TAGS } from '../../supabase/functions/_shared/bay-stages.ts'

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const time = (iso) => (iso ? new Date(iso).getTime() : Infinity)
// Oldest stage start first; an unknown start goes last.
const byStageSince = (a, b) => time(a.stage_since) - time(b.stage_since)
const REVIEW_DAYS = 3
const DAY_MS = 86400000

// Rough minutes per kind of work, shown as a chip.
const MINUTES = { estimate: 25, application: 20, disclosed: 10, mpg_task: 20, custom: 15 }

// Zoho tasks that belong in Statement/Proposal Review.
const STATEMENT_TASK = /statement|proposal/i
export const isStatementTask = (title) => STATEMENT_TASK.test(String(title || ''))

// DSCR leads are usually investors comparing lenders (Estimate sent); the
// rest are buyers who need a pre-approval (Application sent).
const lowerTags = (tags) => (Array.isArray(tags) ? tags : []).map((t) => String(t).trim().toLowerCase())
const isDscr = (tags) => lowerTags(tags).includes('dscr')
// Review complete: Pre-Approved or Disclosed in FUB takes a file off review.
const reviewDone = (tags) => lowerTags(tags).some((t) => REVIEWED_TAGS.includes(t))

function estimateItem(row, rules, now) {
  const next = nextStep(row, now)
  const days = calendarDaysSince(row.stage_since, now)
  const overdue = next.state === 'overdue'
  return {
    key: `estimate:${row.id}`,
    kind: 'estimate',
    book: 'bay',
    contactId: row.id,
    name: row.name || '(no name)',
    title: 'Work estimate',
    why: overdue ? next.text : days == null ? `In ${row.stage}` : `Working ${plural(days, 'day')}`,
    late: overdue || !!stuckFor(row, rules, now),
    minutes: MINUTES.estimate,
    suggestedSent: isDscr(row.tags) ? 'estimate_sent' : 'application_sent',
  }
}

function applicationItem(row, rules, now) {
  const docs = row.docs_outstanding_count || 0
  const days = calendarDaysSince(row.stage_since, now)
  return {
    key: `application:${row.id}`,
    kind: 'application',
    book: 'bay',
    contactId: row.id,
    name: row.name || '(no name)',
    title: 'Review application',
    why: docs > 0 ? `${plural(docs, 'doc')} missing` : days == null ? `In ${row.stage}` : `In ${row.stage} ${plural(days, 'day')}`,
    late: docs > 0 || !!stuckFor(row, rules, now),
    minutes: MINUTES.application,
    docs,
  }
}

function disclosedItem(row, now) {
  const days = calendarDaysSince(row.stage_since, now)
  return {
    key: `disclosed:${row.id}`,
    kind: 'disclosed',
    book: 'bay',
    contactId: row.id,
    name: row.name || '(no name)',
    title: 'Track to closing',
    why: days == null ? 'Disclosed' : `Disclosed ${plural(days, 'day')}`,
    late: false,
    minutes: MINUTES.disclosed,
  }
}

function mpgTaskItem(task, now) {
  const late = task.due_at ? overdueDays(task.due_at, now) : null
  return {
    key: `mpg_task:${task.id}`,
    kind: 'mpg_task',
    book: 'mpg',
    taskId: task.id,
    contactId: task.contact_id || null,
    name: [task.company, task.contact_name].filter(Boolean).join(' · ') || '(no lead)',
    title: task.title || 'Zoho task',
    why: late == null ? 'No due date' : late >= 1 ? `Due ${plural(late, 'day')} ago` : late === 0 ? 'Due today' : `Due ${dueLabel(task.due_at, now)}`,
    late: late != null && late >= 1,
    minutes: MINUTES.mpg_task,
  }
}

function customItem(row, now) {
  const days = calendarDaysSince(row.created_at, now)
  const late = row.due_on ? overdueDays(row.due_on, now) : null
  const due = late == null ? null : late >= 1 ? `Due ${plural(late, 'day')} ago` : late === 0 ? 'Due today' : `Due ${backLabel(row.due_on, now)}`
  return {
    key: `custom:${row.id}`,
    kind: 'custom',
    book: row.business_id,
    contactId: row.contact_id || null,
    name: row.contact_name || '',
    title: row.title,
    why: due || (days == null || days === 0 ? 'Added today' : `Added ${plural(days, 'day')} ago`),
    late: late != null && late >= 1,
    minutes: MINUTES.custom,
  }
}

// Is a done row still in force? stageSince: when the lead entered the stage.
function doneHides(item, row, stageSince, now) {
  if (item.kind === 'mpg_task' || item.kind === 'custom') return true
  const at = time(row.done_at)
  if (stageSince && at < time(stageSince)) return false // re-entered the stage since
  if (item.kind === 'application') {
    // A doc came in or a new one was asked for since the review: back now.
    if (row.review_docs != null && row.review_docs !== item.docs) return false
    return now - at < REVIEW_DAYS * DAY_MS
  }
  return true
}

// Merge an item with its row. Returns null when done hides it.
function withRow(item, row, stageSince, now) {
  if (!row) return { ...item, rowId: null, status: 'open', notes: null }
  if (row.status === 'done' && doneHides(item, row, stageSince, now)) return null
  return {
    ...item,
    rowId: row.id,
    status: row.status === 'done' ? 'open' : row.status,
    waitingOn: row.waiting_on || null,
    checkBackOn: row.check_back_on || null,
    notes: row.notes || null,
  }
}

const backLabel = (day, now) => {
  const l = dueLabel(day, now)
  return l === 'Today' || l === 'Tomorrow' ? l.toLowerCase() : l
}

// pipeline: v_active_pipeline rows (Bayway). mpgTasks: open v_tasks rows for MPG.
// workItems: this user's work_items rows (open, plus recently done).
export function buildWorkGroups({ pipeline = [], mpgTasks = [], workItems = [], rules, now = Date.now() }) {
  const bySource = new Map(workItems.filter((w) => w.source_key).map((w) => [w.source_key, w]))
  const merge = (item, stageSince) => withRow(item, bySource.get(item.key), stageSince, now)
  const inStage = (stage) => pipeline.filter((r) => r.stage === stage)

  const estimates = inStage('Contacted/Working').sort(byStageSince).map((r) => merge(estimateItem(r, rules, now), r.stage_since))
  const applications = inStage('Application Received')
    .filter((r) => !reviewDone(r.tags))
    .sort((a, b) => (b.docs_outstanding_count || 0) - (a.docs_outstanding_count || 0) || byStageSince(a, b))
    .map((r) => merge(applicationItem(r, rules, now), r.stage_since))
  // Longest disclosed first.
  const disclosed = inStage('Disclosed').sort(byStageSince).map((r) => merge(disclosedItem(r, now), r.stage_since))
  const own = workItems
    .filter((w) => w.kind === 'custom' && w.status !== 'done')
    // Earliest due first; undated after, oldest first.
    .sort((a, b) => time(a.due_on) - time(b.due_on) || time(a.created_at) - time(b.created_at))
    .map((w) => withRow(customItem(w, now), w, null, now))
  const statements = [
    ...mpgTasks
      .filter((t) => isStatementTask(t.title))
      .sort((a, b) => time(a.due_at) - time(b.due_at))
      .map((t) => merge(mpgTaskItem(t, now))),
    ...own.filter((it) => it && it.book === 'mpg'),
  ]
  const custom = own.filter((it) => it && it.book !== 'mpg')

  // Waiting items sit in "Waiting on others" until their check-back day, then
  // return to their own group, earliest check-back first, flagged.
  const waiting = []
  const settle = (items) => {
    const back = []
    const rest = []
    for (const it of items) {
      if (!it) continue
      if (it.status !== 'waiting') {
        rest.push(it)
        continue
      }
      const late = it.checkBackOn ? overdueDays(it.checkBackOn, now) : null
      const who = it.waitingOn || 'others'
      if (late == null || late < 0) {
        waiting.push({ ...it, why: `Waiting on ${who}${it.checkBackOn ? ` · check back ${backLabel(it.checkBackOn, now)}` : ''}` })
      } else {
        back.push({ ...it, why: `Check back ${late === 0 ? 'today' : `${plural(late, 'day')} late`} · ${who}`, late: late >= 1, lateDays: late })
      }
    }
    back.sort((a, b) => b.lateDays - a.lateDays)
    return [...back.map(({ lateDays, ...it }) => it), ...rest]
  }

  const groups = [
    { id: 'estimates', title: 'Estimates to Work', book: 'bay', items: settle(estimates) },
    { id: 'applications', title: 'Applications to Review', book: 'bay', items: settle(applications) },
    { id: 'disclosed', title: 'Disclosed', book: 'bay', items: settle(disclosed) },
    { id: 'statements', title: 'Statement/Proposal Review', book: 'mpg', items: settle(statements) },
    { id: 'custom', title: 'Other work', book: null, items: settle(custom) },
  ]
  waiting.sort((a, b) => time(a.checkBackOn) - time(b.checkBackOn))
  return [...groups, { id: 'waiting', title: 'Waiting on others', book: null, items: waiting }]
}

// Header "Work done / total": rows done today versus open items plus those.
export function workProgress(workItems, openCount, now = Date.now()) {
  const today = dayKey(new Date(now).toISOString())
  const done = workItems.filter((w) => w.status === 'done' && w.done_at && dayKey(w.done_at) === today).length
  return { done, total: openCount + done }
}
