// Scheduled FollowUpBoss ACTIVITY sync (calls, texts, emails, notes,
// appointments). Separate from fub-sync so it runs on its own cadence and logs
// its own sync_log line ('fub-activity'). Read-only against FUB: only GETs,
// never writes back. See docs/phase-activity-fub-setup.md.

import { serviceClient, logSync, fetchAll } from '../_shared/db.ts'
import { fetchPersonById } from '../_shared/fub.ts'
import { myFubUserId, unresolvedPersonIds, keepActivityRecord } from '../_shared/fub-owner.ts'
import {
  fetchCalls,
  fetchTexts,
  fetchNotes,
  fetchAppointments,
  fetchEmailsForContact,
  mapActivity,
  dedupeByExternalId,
} from '../_shared/fub-activity.ts'

const NINETY_DAYS_MS = 90 * 86_400_000
// Owner lookups per run for people not in our contacts (see below).
const MAX_OWNER_LOOKUPS = 200

Deno.serve(async (req) => {
  const db = serviceClient()
  let upserted = 0

  // Optional one-time backfill: POST { "since": "2026-01-17T00:00:00Z" } (or
  // ?since=...) widens the window for the globally-listable types so history
  // can be pulled in one pass. Absent => normal incremental behavior. The email
  // pass intentionally ignores this (it stays incremental) to avoid one /emails
  // call per contact across the whole book in a single invocation.
  let overrideSince = null
  try {
    overrideSince = new URL(req.url).searchParams.get('since')
    if (!overrideSince && req.method === 'POST') {
      const body = await req.json().catch(() => ({}))
      overrideSince = body?.since || null
    }
  } catch {
    // no request/body — run incrementally
  }

  try {
    // FUB person id -> our contacts.id, so activities resolve their contact.
    // Paginate past the 1000-row cap: a truncated map silently drops the
    // contact link on every activity beyond it. fetchAll also throws on error,
    // which this read previously swallowed — an empty map would have nulled
    // every activity's contact while logging ok.
    let contactMapRows
    try {
      contactMapRows = await fetchAll(() =>
        db.from('contacts').select('id, external_id').eq('source_crm', 'fub'),
      )
    } catch (e) {
      throw new Error(`contact map: ${e?.message || e}`)
    }
    const contactIdByExternal = new Map(contactMapRows.map((r) => [r.external_id, r.id]))

    // Incremental since the last successful run; first run is bounded to 90 days
    // so we don't pull the entire history of an 800+ contact account at once.
    const { data: lastOk } = await db
      .from('sync_log')
      .select('ran_at')
      .eq('source', 'fub-activity')
      .eq('status', 'ok')
      .order('ran_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const since = lastOk?.ran_at || new Date(Date.now() - NINETY_DAYS_MS).toISOString()
    // Global (listable) types honor a backfill override; email pass keeps `since`.
    const globalSince = overrideSince || since

    // Each activity type is fetched independently so one endpoint's failure
    // can't abort the rest. Some FUB list endpoints can't be listed globally
    // (e.g. /textMessages requires a personId filter and 400s otherwise) — we
    // skip those and record which ones in the sync_log message.
    const fetchers = [
      ['call', fetchCalls],
      ['text', fetchTexts],
      ['note', fetchNotes],
      ['appointment', fetchAppointments],
    ]

    const rows = []
    const counts = []
    const skipped = []
    for (const [type, fetchFn] of fetchers) {
      try {
        const records = await fetchFn(globalSince)
        for (const rec of records) rows.push(mapActivity(rec, type, contactIdByExternal))
        counts.push(`${type}:${records.length}`)
      } catch (e) {
        skipped.push(`${type} (${String(e?.message || e).slice(0, 100)})`)
      }
    }

    // Per-contact email pass. /emails won't list account-wide, so fetch by
    // personId — but only for contacts touched since `since`. A new email bumps
    // the contact's lastActivity, so the recently-touched set is exactly the
    // one that can have new email, keeping this from being one call per contact
    // in the whole book every run.
    try {
      // Bounded by `since`, but a first run reaches back 90 days and can return
      // the whole active book — paginate so it can't truncate. A throw here is
      // caught below and recorded as a skipped email pass, not a sync failure.
      const recentContacts = await fetchAll(() =>
        db
          .from('contacts')
          .select('id, external_id')
          .eq('business_id', 'bay')
          .eq('source_crm', 'fub')
          .gte('last_touch_at', since),
      )
      let emailCount = 0
      for (const c of recentContacts) {
        const emails = await fetchEmailsForContact(c.external_id, since)
        for (const rec of emails) {
          const row = mapActivity(rec, 'email', contactIdByExternal)
          if (!row.contact_id) row.contact_id = c.id // we fetched by this person
          rows.push(row)
        }
        emailCount += emails.length
      }
      counts.push(`email:${emailCount}`)
    } catch (e) {
      skipped.push(`email (${String(e?.message || e).slice(0, 100)})`)
    }

    // A repeated external_id in one batch fails the whole upsert (and, since
    // `since` only advances on an ok run, every run after it). See
    // dedupeByExternalId.
    // Chandler's book only (see _shared/fub-owner.ts). The contact map holds
    // only his people, so activity on anyone else's lead won't resolve. Look
    // each unknown person up once to tell another agent's lead (dropped) from
    // one of his the contact sync hasn't stored yet (kept: since only moves
    // forward, dropping it would lose that activity for good).
    const myId = myFubUserId((k) => Deno.env.get(k))
    let owned = rows
    if (myId) {
      const ownerByPersonId = new Map()
      for (const pid of unresolvedPersonIds(rows.map((r) => r.raw), contactIdByExternal).slice(0, MAX_OWNER_LOOKUPS)) {
        try {
          const p = await fetchPersonById(pid)
          ownerByPersonId.set(pid, p?.assignedUserId != null ? String(p.assignedUserId) : '')
        } catch {
          // No entry: kept (see keepActivityRecord).
        }
      }
      owned = rows.filter((r) => keepActivityRecord(r.raw, contactIdByExternal, ownerByPersonId, myId))
      if (owned.length < rows.length) counts.push(`other-agents:${rows.length - owned.length}`)
    }

    const unique = dedupeByExternalId(owned)
    if (unique.length < owned.length) counts.push(`dupes:${owned.length - unique.length}`)
    if (unique.length) {
      const { error } = await db
        .from('activities')
        .upsert(unique, { onConflict: 'source_crm,external_id' })
      if (error) throw new Error(`activity upsert: ${error.message}`)
      upserted += unique.length
    }

    // Only a total wipeout (every endpoint failed) is an error; a partial run
    // still succeeds. The message keeps per-type counts + skips for diagnosis.
    const summary = [
      overrideSince ? `backfill since ${overrideSince}` : '',
      counts.join(' '),
      skipped.length ? `skipped ${skipped.join('; ')}` : '',
    ]
      .filter(Boolean)
      .join(' | ')
    // Error only on a total wipeout — nothing at all was fetched successfully
    // (counts gets an entry for every type that returned, including email).
    const allFailed = counts.length === 0
    await logSync(db, 'fub-activity', allFailed ? 'error' : 'ok', upserted, summary || null)
    return new Response(JSON.stringify({ ok: !allFailed, upserted, counts, skipped }), {
      status: allFailed ? 500 : 200,
      headers: { 'content-type': 'application/json' },
    })
  } catch (err) {
    await logSync(db, 'fub-activity', 'error', upserted, String(err?.message || err))
    return new Response(JSON.stringify({ ok: false, error: String(err?.message || err) }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
})
