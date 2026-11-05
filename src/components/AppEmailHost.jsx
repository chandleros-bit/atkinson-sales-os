// Application Sent email preview (spec 2026-11-05-application-sent-email-design.md).
//
// Mounted once in Layout. After any successful move of a Bayway lead to
// Application Sent (crm-action:done, from any surface) or when the Move stage
// sheet asks (app-email:open), it shows the email the lead will get: To,
// subject, body, a version picker, Send / Skip. Send runs crm-action
// send_app_email, which tags the FUB lead; FUB's Tag Added automation sends
// the email from Chandler's Outlook. A lead already emailed never gets the
// dialog again.
import { useCallback, useEffect, useState } from 'react'
import { supabase, isDemoMode } from '../lib/supabase'
import { invokeCrmAction } from '../lib/writeback'
import { buildActionRequest, summarizeResult } from '../lib/crmActions'
import { appEmailOfferFor } from '../lib/appEmail'
import { useAuth } from '../context/AuthContext'
import { showToast } from './Toaster'
import { Sheet, Chip, SubmitButton, inputCls, quickActionTone } from './QuickActions'
import {
  APP_EMAIL_KEY, APP_EMAIL_VARIANTS, defaultVariant, hasAppEmailTag, renderAppEmail,
} from '../../supabase/functions/_shared/app-email.ts'
import { EMAIL_RE } from '../../supabase/functions/_shared/fub-write.ts'

const day = (iso) => new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' })

async function loadLead(contactId) {
  const [c, e, s] = await Promise.all([
    supabase.from('contacts').select('id, business_id, name, email, raw').eq('id', contactId).maybeSingle(),
    supabase.from('lead_emails').select('status, tagged_at, variant').eq('contact_id', contactId).eq('template_key', APP_EMAIL_KEY).maybeSingle(),
    supabase.from('settings').select('value').eq('key', 'app_email').maybeSingle(),
  ])
  const error = c.error || e.error || s.error
  if (error) throw new Error(error.message)
  return { contact: c.data, sent: e.data, cfg: s.data?.value }
}

function Field({ label, children }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted">{label}</div>
      {children}
    </div>
  )
}

function AppEmailDialog({ lead, onClose }) {
  const t = quickActionTone('bay')
  const [variant, setVariant] = useState(() => defaultVariant(lead.tags))
  const [email, setEmail] = useState('')
  const [first, setFirst] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const needEmail = !lead.email
  const needFirst = !lead.firstName
  const to = needEmail ? email.trim() : lead.email
  const firstName = needFirst ? first.trim() : lead.firstName
  const ready = EMAIL_RE.test(to) && Boolean(firstName)
  const { subject, html } = renderAppEmail({ variant, firstName: firstName || '…' })

  const send = async () => {
    setBusy(true)
    setError(null)
    let res
    try {
      res = await invokeCrmAction(buildActionRequest({
        action: 'send_app_email',
        contactId: lead.id,
        variant,
        email: needEmail ? email : '',
        firstName: needFirst ? first : '',
      }))
    } catch (e) {
      res = { status: 'error', error: e.message }
    }
    setBusy(false)
    const summary = summarizeResult(res, 'bay')
    if (summary.tone !== 'ok') {
      setError(summary.text)
      return
    }
    const warned = (res.results || []).some((r) => r.warning)
    showToast({ tone: 'ok', text: `Application email sent to ${to}${warned ? ' (W2 years not updated in FollowUpBoss)' : ''}`, failed: [] })
    onClose()
  }

  return (
    <Sheet title="Send application email" subtitle={lead.name} t={t} onClose={busy ? () => {} : onClose}>
      <div className="space-y-3 text-[13px]">
        <Field label="To">
          {needEmail ? (
            <input
              type="email"
              aria-label="Lead email"
              className={inputCls}
              value={email}
              placeholder="No email in FollowUpBoss: enter one"
              onChange={(e) => setEmail(e.target.value)}
            />
          ) : (
            <div className="font-semibold">{lead.email}</div>
          )}
        </Field>
        {needFirst && (
          <Field label="First name">
            <input aria-label="Lead first name" className={inputCls} value={first} onChange={(e) => setFirst(e.target.value)} />
          </Field>
        )}
        <Field label="Version">
          <div className="flex flex-wrap gap-2">
            {APP_EMAIL_VARIANTS.map((v) => (
              <Chip key={v.key} active={variant === v.key} onClick={() => setVariant(v.key)} t={t}>
                {v.label}
              </Chip>
            ))}
          </div>
        </Field>
        <Field label="Subject">
          <div className="font-semibold">{subject}</div>
        </Field>
        <div
          data-app-email-preview=""
          className="rounded-[10px] border border-line2 bg-panel2 p-3 text-[13px] leading-relaxed [&_a]:font-semibold [&_a]:underline [&_ol]:mb-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-2"
          // Escaped by renderAppEmail; the copy is ours.
          dangerouslySetInnerHTML={{ __html: html }}
        />
        <div className="text-[11.5px] text-muted">
          FollowUpBoss sends it from your Outlook and adds your email signature after “Thank you,”.
          {(needEmail || needFirst) && ' What you type here is saved to the lead in FollowUpBoss.'}
        </div>
      </div>
      {error && (
        <div role="alert" className="mt-3 rounded-[10px] border px-3 py-2 text-[12.5px]" style={{ borderColor: '#f2b8b4', background: 'var(--neg-bg)', color: 'var(--neg-ink)' }}>
          {error}
        </div>
      )}
      <SubmitButton busy={busy} disabled={!ready} t={t} onClick={send}>
        Send
      </SubmitButton>
      <button type="button" disabled={busy} onClick={onClose} className="mt-2 min-h-[40px] w-full text-[12.5px] font-semibold text-muted disabled:opacity-50">
        Skip
      </button>
    </Sheet>
  )
}

export default function AppEmailHost() {
  const { role } = useAuth()
  const [lead, setLead] = useState(null)

  // manual: asked for from the Move stage sheet, so explain a no.
  const offer = useCallback(async (contactId, manual) => {
    if (!contactId || isDemoMode || role === 'assistant') return
    let state
    try {
      state = await loadLead(contactId)
    } catch (e) {
      if (manual) showToast({ tone: 'error', text: `Couldn't load the lead: ${e.message}`, failed: [] })
      return
    }
    const { contact, sent, cfg } = state
    if (!contact || contact.business_id !== 'bay') return
    if (!cfg?.enabled) {
      if (manual) showToast({ tone: 'error', text: 'The application email is off (settings: app_email)', failed: [] })
      return
    }
    const tags = Array.isArray(contact.raw?.tags) ? contact.raw.tags : []
    if (sent?.status === 'tagged' || hasAppEmailTag(tags)) {
      const when = sent?.tagged_at ? ` ${day(sent.tagged_at)}` : ''
      showToast({ tone: 'ok', text: `Application email already sent${when}`, failed: [] })
      return
    }
    setLead({
      id: contact.id,
      name: contact.name,
      email: String(contact.email || '').trim(),
      firstName: String(contact.raw?.firstName || '').trim(),
      tags,
    })
  }, [role])

  useEffect(() => {
    const onDone = (e) => offer(appEmailOfferFor(e.detail), false)
    const onOpen = (e) => offer(e.detail?.contactId, true)
    window.addEventListener('crm-action:done', onDone)
    window.addEventListener('app-email:open', onOpen)
    return () => {
      window.removeEventListener('crm-action:done', onDone)
      window.removeEventListener('app-email:open', onOpen)
    }
  }, [offer])

  if (!lead) return null
  return <AppEmailDialog key={lead.id} lead={lead} onClose={() => setLead(null)} />
}
