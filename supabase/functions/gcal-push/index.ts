// Scheduled push of Sales OS calls, meetings and timed follow-ups
// (contact_events) to a Google Calendar. Triggered every 5 min by pg_cron
// (migration 0062). See docs/phase-gcal-push-setup.md.
//
// One-way: Sales OS -> Google. It only touches events it created (tagged with
// a private extended property), never anything added to that calendar by hand.
// Outlook then shows these by subscribing to the Google calendar's iCal link,
// since there is no write access to the work Outlook calendars.
import { serviceClient, logSync, fetchAll } from '../_shared/db.ts'
import { getAccessToken, CALENDAR_EVENTS_SCOPE } from '../_shared/google-auth.ts'
import { planSync, SOURCE_TAG, dialerCallbackEventRow } from '../_shared/gcal-map.ts'

const SOURCE = 'gcal-push'
const DAY = 86_400_000
const API = 'https://www.googleapis.com/calendar/v3'

async function listOurEvents(token: string, calId: string, timeMin: string, timeMax: string) {
  const out = []
  let pageToken = ''
  do {
    const qs = new URLSearchParams({
      privateExtendedProperty: `source=${SOURCE_TAG}`,
      timeMin,
      timeMax,
      singleEvents: 'true',
      maxResults: '2500',
    })
    if (pageToken) qs.set('pageToken', pageToken)
    const res = await fetch(`${API}/calendars/${encodeURIComponent(calId)}/events?${qs}`, {
      headers: { authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`google list failed: ${res.status} ${await res.text()}`)
    const json = await res.json()
    out.push(...(json.items || []))
    pageToken = json.nextPageToken || ''
  } while (pageToken)
  return out
}

async function call(token: string, method: string, url: string, body?: unknown) {
  return fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

Deno.serve(async () => {
  const db = serviceClient()
  const errors: string[] = []
  const done = { created: 0, updated: 0, deleted: 0 }

  try {
    const rawCreds = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')
    const calId = Deno.env.get('GOOGLE_CALENDAR_ID')
    if (!rawCreds || !calId) {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON / GOOGLE_CALENDAR_ID not set as function secrets')
    }
    let creds
    try {
      creds = JSON.parse(rawCreds)
    } catch (e) {
      throw new Error(`GOOGLE_SERVICE_ACCOUNT_JSON: not valid JSON (${e.message})`)
    }

    // Only the owner's events go to his calendar, not the assistant's.
    const { data: owner, error: ownerErr } = await db
      .from('user_roles')
      .select('user_id')
      .eq('role', 'owner')
      .limit(1)
      .maybeSingle()
    if (ownerErr) throw new Error(`owner read: ${ownerErr.message}`)
    if (!owner?.user_id) throw new Error('no owner row in user_roles')

    const now = Date.now()
    const windowStart = now - DAY
    const windowEnd = now + 60 * DAY
    const timeMin = new Date(windowStart).toISOString()
    const timeMax = new Date(windowEnd).toISOString()

    // Auth before reading anything: a bad key must abort the run.
    const token = await getAccessToken(creds, now, CALENDAR_EVENTS_SCOPE)

    const rows = await fetchAll(() =>
      db
        .from('contact_events')
        .select('id, business_id, kind, starts_at, duration_min, note, remind_min, status, contacts(name, phone, email)')
        .eq('user_id', owner.user_id)
        .gte('starts_at', timeMin)
        .lt('starts_at', timeMax)
        .order('starts_at'),
    )
    // Power Dialer callbacks (migration 0072) ride along as call events.
    const callbacks = await fetchAll(() =>
      db
        .from('dialer_calls')
        .select('id, business_id, callback_at, notes, dialer_leads(first_name, last_name, company, phone_e164, email)')
        .eq('user_id', owner.user_id)
        .eq('outcome', 'callback_requested')
        .gte('callback_at', timeMin)
        .lt('callback_at', timeMax)
        .order('callback_at')
        .order('id'),
    )
    const existing = await listOurEvents(token, calId, timeMin, timeMax)
    const plan = planSync([...rows, ...callbacks.map(dialerCallbackEventRow)], existing, windowStart, windowEnd)
    const base = `${API}/calendars/${encodeURIComponent(calId)}/events`

    for (const ev of plan.creates) {
      let res = await call(token, 'POST', base, ev)
      // 409: the id exists from an earlier run (deleted, or outside the last
      // list). Overwrite it, which also revives a deleted one.
      if (res.status === 409) res = await call(token, 'PUT', `${base}/${ev.id}`, ev)
      if (res.ok) done.created++
      else errors.push(`create ${ev.id}: ${res.status} ${await res.text()}`)
    }
    for (const ev of plan.updates) {
      const res = await call(token, 'PUT', `${base}/${ev.id}`, ev)
      if (res.ok) done.updated++
      else errors.push(`update ${ev.id}: ${res.status} ${await res.text()}`)
    }
    for (const id of plan.deletes) {
      const res = await call(token, 'DELETE', `${base}/${id}`)
      // 404/410: already gone, which is the goal.
      if (res.ok || res.status === 404 || res.status === 410) done.deleted++
      else errors.push(`delete ${id}: ${res.status} ${await res.text()}`)
    }

    const note = `created:${done.created} updated:${done.updated} deleted:${done.deleted}`
    const writes = done.created + done.updated + done.deleted
    if (errors.length) {
      await logSync(db, SOURCE, 'error', writes, `${note}; ${errors.length} failed: ${errors[0].slice(0, 300)}`)
    } else {
      await logSync(db, SOURCE, 'ok', writes, note)
    }
    return new Response(JSON.stringify({ ok: errors.length === 0, ...done, errors }), {
      headers: { 'content-type': 'application/json' },
    })
  } catch (err) {
    const msg = String(err?.message || err)
    await logSync(db, SOURCE, 'error', 0, msg)
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
})
