// Slack pushes (Bayway Bot Engine doc, Sales OS item 7). Every 5 minutes:
// works out what needs action today (_shared/slack-alerts.ts), drops what was
// already sent (slack_alerts_sent), and posts one message per book to that
// book's Slack incoming webhook. Each line links into Sales OS.
//
// Secrets: SLACK_WEBHOOK_BAY (#bayway-alerts), SLACK_WEBHOOK_MPG (#mpg-alerts).
// A book without a webhook is skipped and its alerts stay unsent.
// Sends 7 AM to 9 PM Central only; overnight alerts go out at 7 AM.
// The first run sends nothing but a hello: it marks everything already
// slipping as seen (the briefing covers those), so Slack starts with news.
// Scheduled by 0068. Deployed --no-verify-jwt like the other cron functions.

import { serviceClient, logSync, fetchAll } from '../_shared/db.ts'
import { buildAlerts, planMessages, inSendWindow, NEW_LEAD_HOURS, type Book } from '../_shared/slack-alerts.ts'

const APP_URL = 'https://atkinson-sales-os.vercel.app'
const WEBHOOK: Record<Book, string | undefined> = {
  bay: Deno.env.get('SLACK_WEBHOOK_BAY'),
  mpg: Deno.env.get('SLACK_WEBHOOK_MPG'),
}
const BOOK_NAME: Record<Book, string> = { bay: 'Bayway', mpg: 'MPG' }

async function post(url: string, text: string) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, unfurl_links: false, unfurl_media: false }),
  })
  if (!res.ok) throw new Error(`Slack ${res.status}: ${(await res.text()).slice(0, 200)}`)
}

Deno.serve(async (req) => {
  const db = serviceClient()
  const force = new URL(req.url).searchParams.get('force') === '1'
  try {
    const now = Date.now()
    const books = (Object.keys(WEBHOOK) as Book[]).filter((b) => WEBHOOK[b])
    if (!books.length) {
      await logSync(db, 'slack-alerts', 'ok', 0, 'no Slack webhooks set')
      return Response.json({ ok: true, skipped: 'no webhooks' })
    }
    if (!force && !inSendWindow(now)) return Response.json({ ok: true, skipped: 'outside 7 AM to 9 PM' })

    const { data: settingRows } = await db.from('settings').select('key, value').in('key', ['priority_rules', 'slack_alerts']).limit(2)
    const setting = (k: string) => settingRows?.find((r) => r.key === k)?.value || {}
    const rules = setting('priority_rules')
    const cfg = setting('slack_alerts')
    const base = String(cfg.app_url || APP_URL).replace(/\/$/, '')
    const link = (p: string) => `${base}${p}`

    const since = new Date(now - Math.max(NEW_LEAD_HOURS, 24) * 3_600_000).toISOString()
    const ratings = await fetchAll(() => db.from('lead_ratings').select('contact_id, temperature').order('contact_id'))
    const temp = new Map(ratings.map((r) => [r.contact_id, r.temperature]))
    const hotIds = ratings.filter((r) => r.temperature === 'hot').map((r) => r.contact_id)
    const ors = [`last_inbound_at.gte.${since}`, `crm_created_at.gte.${since}`, 'is_hot.eq.true']
    if (hotIds.length) ors.push(`id.in.(${hotIds.join(',')})`)
    const cols = 'id, business_id, name, stage, is_hot, is_partner, crm_created_at, crm_last_activity_at, last_outbound_at, last_outbound_call_at, last_inbound_at'
    const signals = (await fetchAll(() => db.from('v_lead_signals').select(cols).or(ors.join(',')).order('id')))
      .map((r) => ({ ...r, temperature: temp.get(r.id) || null }))

    const pipeline = await fetchAll(() =>
      db.from('v_active_pipeline').select('id, name, stage, last_touch_at, docs_outstanding_count, docs_oldest_requested_at')
        .eq('business_id', 'bay').eq('stage', 'Application Received').order('id'))

    const { data: loanRows, error: loanErr } = await db.from('loans')
      .select('id, borrower_name, firm_closing_on, lock_expires_on, funded_on, stage_group, scenario_auto, scenario_override')
      .eq('business_id', 'bay').is('funded_on', null).in('stage_group', ['prospect', 'processing', 'closing']).limit(1000)
    if (loanErr) throw new Error(`loans: ${loanErr.message}`)
    const loans = (loanRows || []).map((l) => ({ ...l, scenario: l.scenario_override ?? !!l.scenario_auto }))

    const { data: logRows, error: logErr } = await db.from('sync_log').select('source, status, ran_at, message')
      .gte('ran_at', new Date(now - 2 * 3_600_000).toISOString()).order('ran_at', { ascending: false }).limit(1000)
    if (logErr) throw new Error(`sync_log: ${logErr.message}`)
    const latest = new Map<string, { source: string; status: string; ran_at: string; message?: string | null }>()
    for (const r of logRows || []) if (!latest.has(r.source)) latest.set(r.source, r)

    const alerts = buildAlerts({
      signals, pipeline, loans, syncs: [...latest.values()],
      hotColdDays: Number(rules.hot_cold_days ?? 3),
      useCrmActivity: rules.use_crm_last_activity_fallback !== false,
      link, now,
    }).filter((a) => books.includes(a.book))

    const { count } = await db.from('slack_alerts_sent').select('key', { count: 'exact', head: true })
    if (!count) {
      // First run: mark what's already slipping as seen, then say hello.
      const rows = [...new Set(alerts.map((a) => a.key))].map((key) => ({ key, book: alerts.find((a) => a.key === key)!.book }))
      rows.push({ key: 'hello', book: books[0] })
      const { error } = await db.from('slack_alerts_sent').upsert(rows, { onConflict: 'key' })
      if (error) throw new Error(`slack_alerts_sent: ${error.message}`)
      for (const b of books) {
        await post(WEBHOOK[b]!, `:wave: ${BOOK_NAME[b]} alerts are on. You'll get a push here only when something needs you today: a new lead, someone reaching out, a hot lead going cold, a file at risk, a closing or rate lock within 3 days, or a failed sync. Everything else stays in the 7:30 AM briefing.`)
      }
      await logSync(db, 'slack-alerts', 'ok', 0, `first run: ${rows.length - 1} existing alerts marked seen`)
      return Response.json({ ok: true, first_run: true, seen: rows.length - 1 })
    }

    const keys = alerts.map((a) => a.key)
    const sent = new Set<string>()
    for (let i = 0; i < keys.length; i += 200) {
      const { data, error } = await db.from('slack_alerts_sent').select('key').in('key', keys.slice(i, i + 200)).limit(200)
      if (error) throw new Error(`slack_alerts_sent: ${error.message}`)
      for (const r of data || []) sent.add(r.key)
    }

    let pushed = 0
    const failures: string[] = []
    for (const m of planMessages(alerts, sent, link)) {
      try {
        await post(WEBHOOK[m.book]!, m.text)
      } catch (e) {
        failures.push(`${m.book}: ${String((e as Error)?.message || e)}`)
        continue
      }
      const { error } = await db.from('slack_alerts_sent').upsert(m.keys.map((key) => ({ key, book: m.book })), { onConflict: 'key' })
      if (error) failures.push(`${m.book} mark sent: ${error.message}`)
      pushed += m.keys.length
    }
    await logSync(db, 'slack-alerts', failures.length ? 'error' : 'ok', pushed, failures.join('; ') || null)
    return Response.json({ ok: !failures.length, alerts: alerts.length, pushed, failures })
  } catch (err) {
    await logSync(db, 'slack-alerts', 'error', 0, String((err as Error)?.message || err))
    return Response.json({ ok: false, error: String((err as Error)?.message || err) }, { status: 500 })
  }
})
