// Scheduled Priority-Leads scorer. Reads the shared `activities` table (calls,
// notes, appointments, emails) plus each contact's FUB `HOT` tag, computes a
// 0-100 score + tier per Bayway/FUB contact, and writes score/tier/
// last_activity_at back to the contact row. Read-only against FUB — it only
// touches our own Supabase tables. Logs sync_log source 'score-fub-leads'.
// See docs/phase-priority-leads-setup.md.

import { serviceClient, logSync } from '../_shared/db.ts'
import { scoreContact, assignTier, isHotTag } from '../_shared/scoring.ts'

const SIX_MONTHS_MS = 182 * 86_400_000
const SCORING_TYPES = ['call', 'note', 'appointment', 'email']

// PostgREST caps a single response at 1000 rows; page through with range().
async function fetchAll(makeQuery) {
  const pageSize = 1000
  let from = 0
  const rows = []
  while (true) {
    const { data, error } = await makeQuery().range(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    rows.push(...(data || []))
    if (!data || data.length < pageSize) break
    from += pageSize
  }
  return rows
}

Deno.serve(async () => {
  const db = serviceClient()

  try {
    const since = new Date(Date.now() - SIX_MONTHS_MS).toISOString()

    // Bayway/FUB contacts (raw only for the HOT tag).
    const contacts = await fetchAll(() =>
      db.from('contacts').select('id, external_id, raw').eq('business_id', 'bay').eq('source_crm', 'fub'),
    )

    // Scoring-window activities, grouped by contact.
    const activities = await fetchAll(() =>
      db
        .from('activities')
        .select('contact_id, type, occurred_at, raw')
        .eq('business_id', 'bay')
        .in('type', SCORING_TYPES)
        .gte('occurred_at', since),
    )
    const byContact = new Map()
    for (const a of activities) {
      if (!a.contact_id) continue
      const arr = byContact.get(a.contact_id) || []
      arr.push({
        type: a.type,
        occurredAt: a.occurred_at,
        durationSeconds: a.type === 'call' ? a.raw?.duration ?? null : null,
      })
      byContact.set(a.contact_id, arr)
    }

    // Contacts currently sitting in a derived pipeline stage => "active" tier.
    const pipeline = await fetchAll(() =>
      db.from('v_active_pipeline').select('id, stage').eq('business_id', 'bay'),
    )
    const inOpenPipeline = new Set(pipeline.filter((r) => r.stage).map((r) => r.id))

    const tierCounts = { hot: 0, warm: 0, active: 0, never_contacted: 0 }
    const updates = []
    for (const c of contacts) {
      const acts = byContact.get(c.id) || []
      const hasHotTag = isHotTag(c.raw?.tags)
      const { score, lastActivityAt, activityCount } = scoreContact(acts, { hasHotTag })
      const tier = assignTier({
        score,
        lastActivityAt,
        activityCount,
        inOpenPipeline: inOpenPipeline.has(c.id),
        hasHotTag,
      })
      tierCounts[tier] += 1
      // Include the identity columns so the upsert's INSERT branch is valid;
      // ON CONFLICT only SETs the columns present here, so name/email/raw/etc.
      // on the existing row are left untouched.
      updates.push({
        business_id: 'bay',
        source_crm: 'fub',
        external_id: c.external_id,
        score,
        tier,
        last_activity_at: lastActivityAt,
      })
    }

    // Write back in chunks (bulk upsert on the source_crm,external_id key).
    const CHUNK = 500
    for (let i = 0; i < updates.length; i += CHUNK) {
      const { error } = await db
        .from('contacts')
        .upsert(updates.slice(i, i + CHUNK), { onConflict: 'source_crm,external_id' })
      if (error) throw new Error(`contacts write: ${error.message}`)
    }

    const summary = `scored ${updates.length} | hot:${tierCounts.hot} warm:${tierCounts.warm} active:${tierCounts.active} never:${tierCounts.never_contacted}`
    await logSync(db, 'score-fub-leads', 'ok', updates.length, summary)
    return new Response(JSON.stringify({ ok: true, scored: updates.length, tierCounts }), {
      headers: { 'content-type': 'application/json' },
    })
  } catch (err) {
    await logSync(db, 'score-fub-leads', 'error', 0, String(err?.message || err))
    return new Response(JSON.stringify({ ok: false, error: String(err?.message || err) }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
})
