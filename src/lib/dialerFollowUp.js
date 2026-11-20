// Power Dialer follow-ups and callbacks (spec 2026-11-20, "Quick follow-up"
// and "Callback requested also creates"). Pure: template filling, the sms:
// and mailto: links, and the Sales OS work item a callback creates.
import { smsHref } from './dialTexts'
import { formatPhone } from './phone'
import { dayKey } from './calendar'

const FOLLOW_UP = new Set(['interested', 'appointment_set', 'callback_requested', 'application_sent'])
export const offersFollowUp = (outcome) => FOLLOW_UP.has(outcome)

const leadName = (l) => [l.first_name, l.last_name].filter(Boolean).join(' ')

// {first_name} {last_name} {name} {company}. A blank field takes its stray
// space or comma with it ("Hi {first_name}, ..." -> "Hi, ...").
export function fillTemplate(tpl, lead) {
  const vals = { first_name: lead.first_name, last_name: lead.last_name, name: leadName(lead), company: lead.company }
  return String(tpl || '')
    // A blank field drops the ", " or " " in front of it too.
    .replace(/(,? ?)\{(\w+)\}/g, (m, before, k) => (vals[k] ? `${before}${vals[k]}` : ''))
    .replace(/[ \t]+$/gm, '')
}

export function followUpLinks(lead, script) {
  const sms = smsHref(lead.phone_e164, fillTemplate(script?.sms_template, lead))
  const email = lead.email
    ? `mailto:${encodeURIComponent(lead.email)}?subject=${encodeURIComponent(fillTemplate(script?.email_subject, lead))}&body=${encodeURIComponent(fillTemplate(script?.email_body, lead))}`
    : null
  return { sms, email }
}

export function followUpHint(outcome, business) {
  if (outcome === 'appointment_set') return business === 'bay' ? 'Send the Calendly link to lock in the time.' : 'Send a confirmation with the meeting time.'
  if (outcome === 'application_sent') return 'Send the application link.'
  return null
}

// The Sales OS task for a callback: a custom work item due that day (the
// CRM-synced tasks table is read-only to the app). The calendar event comes
// from gcal-push, which reads the callback off dialer_calls.
export function callbackWorkItem(lead, callbackAtIso, notes) {
  const who = leadName(lead) || lead.company || 'lead'
  const at = new Date(callbackAtIso)
  const lines = [
    `Power Dialer callback at ${at.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`,
    `Phone: ${formatPhone(String(lead.phone_e164 || '').replace(/^\+1/, '')) || lead.phone_e164 || ''}`,
  ]
  if (lead.company && leadName(lead)) lines.push(`Company: ${lead.company}`)
  if (notes) lines.push(notes)
  return {
    business_id: lead.business_id,
    kind: 'custom',
    title: `Callback: ${who}`,
    due_on: dayKey(callbackAtIso),
    status: 'open',
    notes: lines.join('\n'),
  }
}
