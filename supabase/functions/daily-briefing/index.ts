// Chandler's 7:30 AM briefing (spec 2026-11-03, section 3; plan
// docs/superpowers/plans/2026-11-04-daily-briefing.md). pg_cron calls this at
// 12:30 and 13:30 UTC on weekdays (migration 0055); it sends only at 7:xx
// Chicago (or 8:xx, to retry a failed run), once per day: a briefing_sends row
// (day, recipient) is claimed before sending and released if the send fails. A request with header x-briefing-test equal to the
// BRIEFING_TEST_KEY secret skips the window and the once-a-day check and
// prefixes the subject with [TEST]; it never claims and logs to
// 'briefing-owner-test'. Callers get only { ok } (details go to sync_log). Deployed --no-verify-jwt like the syncs.
//
// The service role bypasses RLS, so per-user tables (work_items, dial_skips)
// are read for every user. Fine while there is one user; revisit with the
// assistant login (spec section 3).
import { serviceClient, logSync, fetchAll } from '../_shared/db.ts'
import { sendGmail } from '../_shared/gmail-smtp.ts'
import {
  buildOwnerBriefing, renderOwnerBriefing, shouldSend, chicagoDayRangeUtc, previousBusinessDayRangeUtc, chicagoDateKey, CORE_SOURCES,
} from './briefing.bundle.js'

const SOURCE = 'briefing-owner'
const TEST_SOURCE = 'briefing-owner-test'
const SEND_TIMEOUT_MS = 30_000
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const setting = async (db, key) => {
  const { data, error } = await db.from('settings').select('value').eq('key', key).maybeSingle()
  if (error) throw new Error(`setting ${key}: ${error.message}`)
  return data?.value ?? null
}
// A hung SMTP connection becomes a logged error instead of a stuck function.
const withTimeout = (promise, ms) => {
  let timer
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`send timed out after ${ms / 1000}s`)), ms) })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

Deno.serve(async (req) => {
  const now = Date.now()
  const testKey = Deno.env.get('BRIEFING_TEST_KEY')
  const isTest = !!testKey && req.headers.get('x-briefing-test') === testKey
  let db
  let claimed = null
  try {
    db = serviceClient()
    const cfg = (await setting(db, 'briefings')) || {}
    if (!cfg.enabled && !isTest) return json(200, { ok: true, skipped: true })
    if (!isTest && !shouldSend(now)) return json(200, { ok: true, skipped: true })

    const today = chicagoDayRangeUtc(now)
    const to = cfg.owner_email || 'chandler@baywayhtx.com'
    if (!isTest) {
      // Claim today's send; a unique violation means it already went out.
      const { error } = await db.from('briefing_sends').insert({ day: chicagoDateKey(now), recipient: to })
      if (error?.code === '23505') return json(200, { ok: true, skipped: true })
      if (error) throw new Error(`claim: ${error.message}`)
      claimed = { day: chicagoDateKey(now), recipient: to }
    }

    // The previous business day (Monday looks at Friday), Chicago time.
    const yesterday = previousBusinessDayRangeUtc(now)
    // First day of last month (Chicago), for this-month vs last-month numbers.
    const [cy, cm] = chicagoDateKey(now).split('-').map(Number)
    const since = new Date(Date.UTC(cy, cm - 2, 1)).toISOString().slice(0, 10)
    // A "Not today" skip hides a lead while until_date is after today.
    const tomorrowKey = chicagoDateKey(now, 1)

    const [rules, targets, rates, forecastSettings] = await Promise.all(
      ['priority_rules', 'metric_targets', 'arive', 'forecast'].map((k) => setting(db, k)),
    )
    const [metrics, mpgMetricRows, deals, activities, yesterdayActivities, pipeline, loans, ratings, signals, dialRows, dialSkips, mpgTasks, workItems, events] = await Promise.all([
      fetchAll(() => db.from('metrics_daily').select('date, business_id, metric_key, value').gte('date', since).order('id')),
      // Newest first, for latestMpgMetrics. A plain query: fetchAll's range() would override limit().
      db.from('metrics_daily').select('date, business_id, metric_key, value').eq('business_id', 'mpg').in('metric_key', ['rev_monthly_residual', 'rev_active_merchants']).order('date', { ascending: false }).order('id').limit(120)
        .then(({ data, error }) => { if (error) throw new Error(error.message); return data || [] }),
      fetchAll(() => db.from('deals').select('status, value, expected_close, business_id').eq('business_id', 'bay').order('id')),
      fetchAll(() => db.from('activities').select('occurred_at, type, business_id').eq('direction', 'outbound').in('type', ['call', 'text', 'email']).gte('occurred_at', `${since}T00:00:00Z`).order('id')),
      fetchAll(() => db.from('activities').select('type, direction, raw').gte('occurred_at', yesterday.from).lt('occurred_at', yesterday.to).order('id')),
      // The whole Bayway board (no stage filter); the builders pick their stages.
      fetchAll(() => db.from('v_active_pipeline').select('id, business_id, name, stage, stage_since, last_touch_at, crm_created_at, last_outbound_call_at, open_task_count, oldest_open_due_at, docs_outstanding_count, docs_oldest_requested_at').eq('business_id', 'bay').order('id')),
      fetchAll(() => db.from('loans').select('id, borrower_name, role, amount, stage_group, funded_on, firm_closing_on, application_on, contact_id, comp_override, scenario_auto, scenario_override, updated_at, last_seen_at').order('id')),
      fetchAll(() => db.from('lead_ratings').select('contact_id, business_id, temperature, est_amount, close_month, rated_at, contact:contacts(name)').order('contact_id')),
      fetchAll(() => db.from('v_lead_signals').select('*').order('id')),
      fetchAll(() => db.from('v_dial_contacts').select('*').order('id')),
      fetchAll(() => db.from('dial_skips').select('contact_id').gte('until_date', tomorrowKey).order('id')),
      fetchAll(() => db.from('v_tasks').select('id, title, due_at, contact_id, contact_name, company, business_id').eq('business_id', 'mpg').order('id')),
      fetchAll(() => db.from('work_items').select('id, business_id, kind, contact_id, title, status, waiting_on, check_back_on, due_on, created_at, done_at, contact:contacts(name)').neq('status', 'done').order('id')),
      fetchAll(() => db.from('calendar_events').select('id, source_account, title, starts_at, is_all_day').gte('starts_at', today.from).lt('starts_at', today.to).order('starts_at')),
    ])
    const syncLatest = {}
    await Promise.all(
      CORE_SOURCES.map(async ({ source }) => {
        const { data } = await db.from('sync_log').select('ran_at, status').eq('source', source).order('ran_at', { ascending: false }).limit(1).maybeSingle()
        if (data) syncLatest[source] = data
      }),
    )

    const model = buildOwnerBriefing({
      rules, targets, rates, forecastSettings, metrics, mpgMetricRows, deals, activities, yesterdayActivities, pipeline, loans, ratings, signals, dialRows,
      dialSkips: dialSkips.map((r) => r.contact_id), mpgTasks,
      workItems: workItems.map(({ contact, ...w }) => ({ ...w, contact_name: contact?.name || null })),
      events, syncLatest,
    }, now)
    const mail = renderOwnerBriefing(model, { appUrl: cfg.app_url || 'https://atkinson-sales-os.vercel.app' })
    await withTimeout(sendGmail({ to, subject: isTest ? `[TEST] ${mail.subject}` : mail.subject, text: mail.text, html: mail.html }), SEND_TIMEOUT_MS)
    claimed = null // sent: keep the claim even if logging fails

    await logSync(db, isTest ? TEST_SOURCE : SOURCE, 'ok', 1, `${isTest ? 'test ' : ''}sent to ${to}: ${mail.subject}`)
    return json(200, { ok: true })
  } catch (err) {
    const message = String(err?.message || err).slice(0, 500)
    // Release the claim so the 8:xx run can retry.
    if (db && claimed) await db.from('briefing_sends').delete().eq('day', claimed.day).eq('recipient', claimed.recipient).then(() => {}, () => {})
    // Without a client there is nothing to log to.
    if (db) await logSync(db, isTest ? TEST_SOURCE : SOURCE, 'error', 0, message).catch(() => {})
    return json(500, { ok: false })
  }
})
