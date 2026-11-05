// crm-action's `app_email` step: the Application Sent email
// (spec 2026-11-05-application-sent-email-design.md).
//
// The OS never sends mail. It adds the version's tag to the FUB lead, and the
// FUB Automations 2.0 automation for that tag (Tag Added -> Send email) sends
// the template from Chandler's connected Outlook. lead_emails makes it once
// per lead: a unique (contact_id, template_key) row is claimed before the tag
// is written, and a lead that already carries an App Email tag in FUB counts
// as sent.

import {
  APP_EMAIL_KEY, APP_EMAIL_SUBJECT, APP_EMAIL_VARIANTS, variantFor, hasAppEmailTag, w2Years, renderAppEmail,
} from '../_shared/app-email.ts'
import { EMAIL_RE } from '../_shared/fub-write.ts'

// A pending claim older than this is treated as a crashed run and taken over.
const STALE_MS = 2 * 60_000

const clean = (v) => (typeof v === 'string' ? v.trim() : '')
const msg = (e) => String(e?.message || e).slice(0, 500)
const day = (iso) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' }).format(new Date(iso))

// Someone else's claim, or a lead already emailed: not a failure of this
// send, so the lead_emails row is left as it is.
export class Refusal extends Error {}

// settings.app_email = { enabled, templates: { first_home, next_home, refinance }, published_years }
export async function loadAppEmailSettings(db) {
  const { data } = await db.from('settings').select('value').eq('key', 'app_email').maybeSingle()
  return data?.value || null
}

// Preflight for send_app_email (Bayway already checked by the caller).
export function appEmailRefusal(cfg, payload, contact) {
  if (!cfg?.enabled) return 'The application email is off (settings: app_email)'
  const v = variantFor(payload?.variant)
  if (!v) return `Unknown email version: ${payload?.variant}`
  if (!Number(cfg.templates?.[v.key])) return `No FUB template id for ${v.label} (settings: app_email.templates)`
  const email = clean(payload?.email)
  if (email && !EMAIL_RE.test(email)) return `Not an email address: ${email}`
  if (!email && !clean(contact?.email)) return 'No email on file in FollowUpBoss. Enter one to send.'
  return null
}

// Insert the claim, or take over a failed / stuck one. The take-over update
// only matches the row as it was read, so two racing sends can't both win.
async function claim(db, row, now) {
  const ins = await db.from('lead_emails').insert(row)
  if (!ins.error) return
  if (ins.error.code !== '23505') throw new Error(`lead_emails insert: ${ins.error.message}`)
  const { data: prev } = await db
    .from('lead_emails')
    .select('status, updated_at, tagged_at')
    .eq('contact_id', row.contact_id)
    .eq('template_key', row.template_key)
    .maybeSingle()
  if (prev?.status === 'tagged') throw new Refusal(`Application email already sent ${day(prev.tagged_at || prev.updated_at)}`)
  const stale = prev?.status === 'pending' && now.getTime() - Date.parse(prev.updated_at) > STALE_MS
  if (!prev || (prev.status === 'pending' && !stale)) throw new Refusal('The application email is already being sent')
  const { data: took, error } = await db
    .from('lead_emails')
    .update(row)
    .eq('contact_id', row.contact_id)
    .eq('template_key', row.template_key)
    .eq('status', prev.status)
    .eq('updated_at', prev.updated_at)
    .select('id')
  if (error) throw new Error(`lead_emails claim: ${error.message}`)
  if (!took?.length) throw new Refusal('The application email is already being sent')
}

// Push the copy to all three FUB templates when this year's W2 line isn't
// there yet. First publish failing fails the send (FUB would send its
// placeholder); a later one only warns (last year's copy is still good).
async function publishIfStale(db, adapter, cfg, now) {
  const years = w2Years(now)
  if (cfg.published_years === years) return null
  try {
    for (const v of APP_EMAIL_VARIANTS) {
      await adapter.send.publishTemplate({
        id: Number(cfg.templates[v.key]),
        name: v.template,
        subject: APP_EMAIL_SUBJECT,
        body: renderAppEmail({ variant: v.key, now, mode: 'fub' }).html,
      })
    }
    const { error } = await db.from('settings').update({ value: { ...cfg, published_years: years } }).eq('key', 'app_email')
    if (error) throw new Error(`settings: ${error.message}`)
    cfg.published_years = years
    return null
  } catch (e) {
    if (!cfg.published_years) throw new Error(`Couldn't publish the email templates to FollowUpBoss: ${msg(e)}`)
    return `FollowUpBoss templates still show ${cfg.published_years} W2s (${msg(e)})`
  }
}

export async function sendAppEmail({ db, adapter, contact, variant, cfg, toEmail, clientActionId, now = new Date() }) {
  const v = variantFor(variant)
  if (!v) throw new Refusal(`Unknown email version: ${variant}`)
  const stamp = now.toISOString()
  const key = { contact_id: contact.id, template_key: APP_EMAIL_KEY }
  await claim(db, {
    ...key,
    variant: v.key,
    to_email: clean(toEmail) || null,
    status: 'pending',
    client_action_id: clientActionId,
    error: null,
    tagged_at: null,
    updated_at: stamp,
  }, now)

  const mark = async (patch) => {
    const { error } = await db
      .from('lead_emails')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('contact_id', key.contact_id)
      .eq('template_key', key.template_key)
      .eq('client_action_id', clientActionId)
    if (error) console.error(`lead_emails mark failed for ${contact.id}: ${error.message}`)
  }

  try {
    const person = await adapter.read.person(contact.external_id)
    if (hasAppEmailTag(person?.tags)) {
      await mark({ status: 'tagged', tagged_at: stamp, error: 'Already tagged in FollowUpBoss' })
      throw new Refusal('Already sent from FollowUpBoss (the lead has an App Email tag)')
    }
    if (!(person?.emails || []).some((e) => clean(e?.value))) throw new Error('No email on file in FollowUpBoss')
    const warning = await publishIfStale(db, adapter, cfg, now)
    await adapter.send.addTag({ externalId: contact.external_id, tag: v.tag })
    await mark({ status: 'tagged', tagged_at: stamp, error: warning })
    return { id: contact.external_id, warning }
  } catch (e) {
    if (!(e instanceof Refusal)) await mark({ status: 'failed', error: msg(e) })
    throw e
  }
}
