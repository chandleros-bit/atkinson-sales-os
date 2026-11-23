// Drafts inbox (Bayway Bot Engine doc, Sales OS item 2). Bots write drafts to
// bot_drafts; Chandler approves, edits or skips them here. Approving an email
// opens it in his mail app (Outlook) ready to send, the way the dial list's
// tap-to-email works, so he still presses Send, and logs a FUB note through
// crm-action. The learning loop reads original vs final text, change size,
// skip reasons and outcomes. Owner-only (RLS).
import { supabase, isDemoMode } from './supabase'
import { invokeCrmAction, loadWritebackFlags } from './writeback'

export const REASONS = ['too long', 'too salesy', 'wrong person', 'wrong timing', 'off voice', 'other']
export const OUTCOMES = ['replied', 'booked', 'attended', 'referred']
export const TYPE_LABEL = { email: 'Email', gbp_post: 'Google post', blog: 'Blog post', newsletter: 'Newsletter', text: 'Text', other: 'Draft' }
export const BOT_LABEL = {
  cold_email: 'Cold Email', newsletter: 'RateUpdate', gbp: 'GBP', seo: 'SEO', agent_classes: 'Agent Classes',
  agent_search: 'Agent Search', crm: 'CRM', investor: 'Investor Scenario',
}
export const botLabel = (bot) => BOT_LABEL[bot] || String(bot || 'Bot')

const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean)

// How much of the bot's text changed, 0 (untouched) to 100 (rewritten): word
// edit distance over the longer version. Subject and body count together.
export function changePct(original, final) {
  const a = words(original)
  const b = words(final)
  if (!a.length && !b.length) return 0
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return Math.min(100, Math.round((prev[b.length] / Math.max(a.length, b.length)) * 100))
}

// mailto: opens the default mail app (Outlook) with the draft filled in.
export function composeUrl({ to_email, subject, body }) {
  const q = [`subject=${encodeURIComponent(subject || '')}`, `body=${encodeURIComponent(body || '')}`].join('&')
  return `mailto:${encodeURIComponent(to_email || '')}?${q}`
}

export async function loadDrafts({ status = 'waiting', days = 30 } = {}) {
  if (isDemoMode) return []
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  const { data, error } =
    status === 'waiting'
      ? await supabase.from('bot_drafts').select('*').eq('status', 'waiting').order('created_at', { ascending: true }).limit(200)
      : await supabase.from('bot_drafts').select('*').neq('status', 'waiting').gte('decided_at', since).order('decided_at', { ascending: false }).limit(200)
  if (error) throw error
  return data || []
}

export async function countWaiting() {
  if (isDemoMode) return 0
  const { count, error } = await supabase.from('bot_drafts').select('id', { count: 'exact', head: true }).eq('status', 'waiting')
  if (error) throw error
  return count || 0
}

// The patch an approval writes, from the text on screen.
export function planApproval(draft, { subject, body }, now = new Date()) {
  const before = `${draft.original_subject || ''}\n${draft.original_body || ''}`
  const after = `${subject || ''}\n${body || ''}`
  return {
    status: 'approved',
    subject: subject || null,
    body,
    final_subject: subject || null,
    final_body: body,
    change_pct: changePct(before, after),
    decided_at: now.toISOString(),
    updated_at: now.toISOString(),
  }
}

// Approve: save the final text, log a FUB note when writeback is on and the
// draft has a contact. Returns { ok, patch, url } where url opens the email.
export async function approveDraft(draft, text) {
  const patch = planApproval(draft, text)
  let crmActionId = null
  if (draft.contact_id && draft.business_id === 'bay') {
    const flags = await loadWritebackFlags()
    if (flags.bay) {
      const clientActionId = crypto.randomUUID()
      const what = TYPE_LABEL[draft.draft_type] || 'Draft'
      const res = await invokeCrmAction({
        client_action_id: clientActionId,
        action: 'add_note',
        contact_id: draft.contact_id,
        payload: { subject: `${what} sent (${botLabel(draft.bot)})`, body: [patch.final_subject, patch.final_body].filter(Boolean).join('\n\n') },
      })
      if (res?.status !== 'ok') return { ok: false, error: res?.error || 'FUB note failed' }
      const { data } = await supabase.from('crm_actions').select('id').eq('client_action_id', clientActionId).maybeSingle()
      crmActionId = data?.id || null
    }
  }
  const full = { ...patch, crm_action_id: crmActionId }
  const { error } = await supabase.from('bot_drafts').update(full).eq('id', draft.id).eq('status', 'waiting')
  if (error) return { ok: false, error: error.message }
  const url = draft.draft_type === 'email' ? composeUrl({ to_email: draft.to_email, subject: full.final_subject, body: full.final_body }) : null
  return { ok: true, patch: full, url }
}

export async function skipDraft(draft, reason, note) {
  if (reason && !REASONS.includes(reason)) throw new Error(`Unknown reason: ${reason}`)
  const now = new Date().toISOString()
  const patch = { status: 'skipped', reason: reason || null, reason_note: note?.trim() || null, decided_at: now, updated_at: now }
  const { error } = await supabase.from('bot_drafts').update(patch).eq('id', draft.id).eq('status', 'waiting')
  if (error) throw error
  return patch
}

export async function setOutcome(draft, outcome) {
  if (outcome && !OUTCOMES.includes(outcome)) throw new Error(`Unknown outcome: ${outcome}`)
  const patch = { outcome: outcome || null, updated_at: new Date().toISOString() }
  const { error } = await supabase.from('bot_drafts').update(patch).eq('id', draft.id)
  if (error) throw error
  return patch
}
