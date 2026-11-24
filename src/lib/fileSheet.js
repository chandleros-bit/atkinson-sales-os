// The Workbench open-file sheet (Workbench v2 spec 2026-11-23, §11). Pure:
// the review steps, the doc reminder text and links, the chips and the "When
// done" choices for one Files item. WorkLane draws the sheet.
import { smsHref } from './dialTexts'

export const TAG = { estimate: 'Estimate', application: 'App', disclosed: 'Disclosed', mpg_task: 'MPG', custom: 'Task' }

// The application review checklist, saved on the work item (work_items.checklist).
export const REVIEW_STEPS = [
  { key: 'credit', label: 'Credit pulled' },
  { key: 'income', label: 'Income calculated' },
  { key: 'assets', label: 'Assets cover down payment and closing costs' },
  { key: 'dti', label: 'DTI under the limit with the new payment' },
  { key: 'letter', label: 'Pre-approval letter issued' },
]

export const reviewDone = (checklist) => REVIEW_STEPS.filter((s) => checklist?.[s.key]).length

const first = (name) => String(name || '').trim().split(/\s+/)[0] || 'there'

// One message asking for every missing doc. docs: names, oldest first.
export function reminderText(name, docs) {
  const list = (docs || []).filter(Boolean)
  if (!list.length) return null
  const items = list.length === 1 ? list[0] : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`
  return `Hi ${first(name)}, a quick reminder on what I still need for your loan: ${items}. You can text or email them to me. Thanks! - Chandler`
}

// -> { sms, email } drafted links (null when there's no number / address). Never sends.
export function reminderLinks({ name, phone, email, docs }) {
  const text = reminderText(name, docs)
  if (!text) return { text: null, sms: null, email: null }
  const mail = email ? `mailto:${email}?subject=${encodeURIComponent('Documents for your loan')}&body=${encodeURIComponent(text)}` : null
  return { text, sms: smsHref(phone, text), email: mail }
}

const money = (n) => `$${Math.round(Number(n)).toLocaleString('en-US')}`

// The header chips: the stage with its age, the loan type and amount, the realtor.
export function fileChips(item, loan = null) {
  return [
    item.why,
    loan?.loan_type && loan?.amount ? `${loan.loan_type} · ${money(loan.amount)}` : loan?.amount ? money(loan.amount) : null,
    loan?.stage && `Arive: ${loan.stage}${loan.lender ? ` · ${loan.lender}` : ''}`,
    loan?.buyer_agent_name && `Realtor: ${loan.buyer_agent_name}`,
  ].filter(Boolean)
}

// "When done" choices, each with what it will do. kind: the item's kind.
// action: 'stage' (crm-action set_stage to `target`), 'reviewed' (hide 3 days),
// 'sent' (the estimate picker), 'complete' (Zoho task), 'done' (dashboard only).
export function doneChoices(item, { name } = {}) {
  const who = name || item.name || 'them'
  switch (item.kind) {
    case 'application':
      return [
        { key: 'pre_approved', label: 'Pre-approved', action: 'stage', target: 'pre_approved', explain: `Moves ${who} to Pre-Approved in FollowUpBoss, which takes the file off review.` },
        { key: 'disclosed', label: 'Disclosed', action: 'stage', target: 'disclosed', explain: `Moves ${who} to Disclosed in FollowUpBoss.` },
        { key: 'reviewed', label: 'Reviewed, no change', action: 'reviewed', explain: 'Hidden for 3 days, or sooner if the missing docs change.' },
      ]
    case 'estimate':
      return [
        { key: 'estimate_sent', label: 'Estimate sent', action: 'stage', target: 'estimate_sent', explain: `Moves ${who} to Estimate sent in FollowUpBoss.` },
        { key: 'application_sent', label: 'Application sent', action: 'stage', target: 'application_sent', explain: `Moves ${who} to Application sent in FollowUpBoss.` },
      ]
    case 'mpg_task':
      return [{ key: 'complete', label: 'Task done', action: 'complete', explain: 'Completes the task in Zoho.' }]
    default:
      return [{ key: 'done', label: 'Done', action: 'done', explain: 'Marks it done here; nothing is sent to a CRM.' }]
  }
}

// The next file after `key` in the Files order, or null.
export function nextFile(items, key) {
  const i = (items || []).findIndex((it) => it.key === key)
  return i >= 0 ? items[i + 1] || null : items?.[0] || null
}
