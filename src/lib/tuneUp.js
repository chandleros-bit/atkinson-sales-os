// Tune-up page (Bayway Bot Engine doc, learning loop): the Friday tune-up
// bot's proposals with Approve and Reject, and each bot's no-edit approval
// rate by week. Approving commits the change to the bayway-bots repo through
// the bot-repo function. Owner-only (RLS).
import { supabase, isDemoMode } from './supabase'
import { botLabel } from './drafts'

export const REPO = 'chandleros-bit/bayway-bots'
export const commitUrl = (sha) => (sha ? `https://github.com/${REPO}/commit/${sha}` : null)
export { botLabel }

export async function loadChanges() {
  if (isDemoMode) return []
  const { data, error } = await supabase.from('bot_changes').select('*').order('created_at', { ascending: false }).limit(200)
  if (error) throw error
  return data || []
}

export async function loadApprovalRows() {
  if (isDemoMode) return []
  const { data, error } = await supabase.from('v_bot_approval_weekly').select('*').order('week_start', { ascending: true }).limit(1000)
  if (error) throw error
  return data || []
}

// rows -> { weeks: [last n Mondays], bots: [{ bot, cells: [{ rate, decided } | null], dropped }] }
// dropped: the latest week with decisions is 10+ points below the one before.
export function approvalTable(rows, n = 8) {
  const weeks = [...new Set((rows || []).map((r) => r.week_start))].sort().slice(-n)
  const byBot = new Map()
  for (const r of rows || []) {
    if (!byBot.has(r.bot)) byBot.set(r.bot, new Map())
    byBot.get(r.bot).set(r.week_start, r)
  }
  const bots = [...byBot.entries()].map(([bot, m]) => {
    const cells = weeks.map((w) => {
      const r = m.get(w)
      return r && Number(r.decided) ? { rate: r.approval_rate == null ? null : Number(r.approval_rate), decided: Number(r.decided) } : null
    })
    const seen = cells.filter((c) => c && c.rate != null)
    const dropped = seen.length >= 2 && seen[seen.length - 1].rate <= seen[seen.length - 2].rate - 10
    return { bot, cells, dropped }
  })
  return { weeks, bots: bots.sort((a, b) => botLabel(a.bot).localeCompare(botLabel(b.bot))) }
}

export async function invokeBotRepo(body) {
  const { data, error } = await supabase.functions.invoke('bot-repo', { body })
  if (error) {
    let msg = error.message
    try { msg = (await error.context?.json())?.error || msg } catch { /* keep message */ }
    return { ok: false, error: msg }
  }
  return data
}

// Approve: mark approved, then commit through bot-repo (which marks it applied
// or failed). Reject: just mark rejected.
export async function decideChange(change, decision) {
  if (!['approved', 'rejected'].includes(decision)) throw new Error('approved or rejected')
  const now = new Date().toISOString()
  const { error } = await supabase.from('bot_changes').update({ status: decision, decided_at: now, error: null }).eq('id', change.id).in('status', ['proposed', 'failed'])
  if (error) throw error
  if (decision === 'rejected') return { ok: true, status: 'rejected' }
  const res = await invokeBotRepo({ action: 'apply', change_id: change.id })
  return res?.ok ? { ok: true, status: 'applied', version: res.version, commit_sha: res.commit_sha } : { ok: false, status: 'failed', error: res?.error || 'Commit failed' }
}

export const syncRepo = () => invokeBotRepo({ action: 'sync' })
