// Chandler's 7:30 AM briefing (spec 2026-11-03, section 3; plan
// docs/superpowers/plans/2026-11-04-daily-briefing.md). pg_cron calls this at
// 12:30 and 13:30 UTC on weekdays (migration 0055); it sends only at 7:xx
// Chicago, once per day. A request with header x-briefing-test equal to the
// BRIEFING_TEST_KEY secret skips the window and the once-a-day check and
// prefixes the subject with [TEST]. Deployed --no-verify-jwt like the syncs.
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
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const setting = async (db, key) => (await db.from('settings').select('value').eq('key', key).maybeSingle()).data?.value ?? null

Deno.serve(async (req) => {
  const db = serviceClient()
  const now = Date.now()
  const testKey = Deno.env.get('BRIEFING_TEST_KEY')
  const isTest = !!testKey && req.headers.get('x-briefing-test') === testKey
  try {
    const cfg = (await setting(db, 'briefings')) || {}
    if (!cfg.enabled && !isTest) return json(200, { skipped: 'disabled' })
    if (!isTest && !shouldSend(now)) return json(200, { skipped: 'outside the 7:00 Chicago window' })

    const today = chicagoDayRangeUtc(now)
    if (!isTest) {
      const { data: sent } = await db.from('sync_log').select('id').eq('source', SOURCE).eq('status', 'ok').gte('ran_at', today.from).limit(1)
      if (sent?.length) return json(200, { skipped: 'already sent today' })
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
      fetchAll(() => db.from('dial_skips').select('contact_id').gte('until_date', tomorrowKey).order('contact_id')),
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
    const to = cfg.owner_email || 'chandler@baywayhtx.com'
    await sendGmail({ to, subject: isTest ? `[TEST] ${mail.subject}` : mail.subject, text: mail.text, html: mail.html })

    await logSync(db, SOURCE, 'ok', 1, `${isTest ? 'test ' : ''}sent to ${to}: ${mail.subject}`)
    return json(200, { ok: true, to, subject: mail.subject })
  } catch (err) {
    const message = String(err?.message || err).slice(0, 500)
    await logSync(db, SOURCE, 'error', 0, message)
    return json(500, { ok: false, error: message })
  }
})
