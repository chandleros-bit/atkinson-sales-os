// Database Opportunity Agent: nightly run (spec build step 5).
// Weekdays before the 7:30 AM briefing (0067). For every Bayway past client
// (FUB source "Past Client"): recompute estimates, apply exclusions, score,
// select today's picks (5, or 15 on Wednesday), write an AI call-prep note per
// pick (template fallback), and save to opportunity_picks. Safe to run twice:
// if today's picks exist it only refreshes estimates.
// Reads only Supabase. Nothing is written to FUB here.
// Env: ANTHROPIC_API_KEY (optional; template notes without it),
//      OPPORTUNITY_MODEL (default claude-haiku-5-5).
// Deployed --no-verify-jwt like the other cron functions. Logs 'opportunity-nightly'.

import { serviceClient, logSync, fetchAll } from '../_shared/db.ts'
import { estimate, type PmmsWeek } from '../_shared/opportunity-estimates.ts'
import { selectPicks, picksForDate, type Candidate } from '../_shared/opportunity-scoring.ts'
import { makeNote, type NoteFacts } from '../_shared/opportunity-note.ts'

const ACTIVE_LOAN = ['prospect', 'processing', 'closing']
const DNC = /do\s*not\s*(call|contact)|\bdnc\b/i

function centralDate(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(d)
}
const phone10 = (p: string) => p.replace(/\D/g, '').slice(-10)
const normAddr = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')

function anthropicAsk(apiKey: string, model: string) {
  return async (system: string, user: string) => {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 700, system, messages: [{ role: 'user', content: user }] }),
    })
    if (!res.ok) throw new Error(`anthropic ${res.status}`)
    const j = await res.json()
    return (j.content ?? []).map((c: { text?: string }) => c.text ?? '').join('')
  }
}

Deno.serve(async () => {
  const db = serviceClient()
  try {
    const today = centralDate()
    const now = new Date()

    const { data: setRow } = await db.from('settings').select('value').eq('key', 'opportunities').maybeSingle()
    const cfg = setRow?.value ?? {}
    const config = {
      weights: cfg.weights, cooldownDays: cfg.cooldown_days ?? 90, minMonthsOwned: cfg.min_months_owned ?? 12,
      activeStages: cfg.active_stages ?? [], licensedStates: cfg.licensed_states ?? ['TX', 'FL'],
    }

    const contacts = await fetchAll(() =>
      db.from('contacts').select('id, external_id, name, phone, stage_key, last_touch_at, raw')
        .eq('business_id', 'bay').eq('source_crm', 'fub').eq('raw->>source', 'Past Client'),
    )
    const ids = contacts.map((c) => c.id)
    const inIds = async (table: string, cols: string) => {
      const out: Record<string, unknown>[] = []
      for (let i = 0; i < ids.length; i += 300) {
        out.push(...(await fetchAll(() => db.from(table).select(cols).in('contact_id', ids.slice(i, i + 300)))))
      }
      return out
    }
    const property = new Map((await inIds('past_client_property', '*')).map((r) => [r.contact_id as string, r]))
    const loans = await inIds('loans', 'contact_id, stage_group, rate, amount, term_months, loan_type, funded_on, closed_on')
    const acts = await inIds('activities', 'contact_id, type, direction, occurred_at')
    const picksHist = await inIds('opportunity_picks', 'contact_id, pick_date')
    const todayIso = today
    const skips = [
      ...(await inIds('dial_skips', 'contact_id, until_date')),
      ...(await inIds('lead_snoozes', 'contact_id, until_date')),
    ].filter((s) => !s.until_date || (s.until_date as string) >= todayIso)
    const pmms = (await fetchAll(() => db.from('pmms_weekly').select('week_date, rate_30_fixed'))) as PmmsWeek[]

    const by = <T extends Record<string, unknown>>(rows: T[]) => {
      const m = new Map<string, T[]>()
      for (const r of rows) { const k = r.contact_id as string; m.set(k, [...(m.get(k) ?? []), r]) }
      return m
    }
    const loansBy = by(loans), actsBy = by(acts), picksBy = by(picksHist)
    const snoozed = new Set(skips.map((s) => s.contact_id as string))

    const candidates: Candidate[] = []
    const facts = new Map<string, NoteFacts>()
    const estimateRows: Record<string, unknown>[] = []

    for (const c of contacts) {
      const raw = (c.raw ?? {}) as Record<string, unknown>
      const p = (property.get(c.id) ?? null) as Record<string, unknown> | null
      const cl = loansBy.get(c.id) ?? []
      const funded = cl.filter((l) => l.funded_on || l.closed_on)
        .sort((a, b) => String(b.funded_on ?? b.closed_on).localeCompare(String(a.funded_on ?? a.closed_on)))[0]
      // Arive facts win where present (rule 1: the actual rate when there is one).
      const f = {
        recording_date: (p?.recording_date as string) ?? (funded ? String(funded.funded_on ?? funded.closed_on) : null),
        sale_price: (p?.sale_price as number) ?? null,
        orig_loan_amount: (p?.orig_loan_amount as number) ?? (funded?.amount as number) ?? null,
        rate_actual: (p?.rate_actual as number) ?? (funded?.rate as number) ?? null,
        term_months: (p?.term_months as number) ?? (funded?.term_months as number) ?? null,
        market_value: (p?.market_value as number) ?? null,
        county: (p?.county as string) ?? null,
      }
      const e = f.recording_date
        ? estimate(f, pmms, { now, valueGrowthByCounty: cfg.value_growth_by_county ?? {} })
        : null
      if (e) estimateRows.push({
        contact_id: c.id, est_rate: e.est_rate, est_balance: e.est_balance, est_value: e.est_value,
        est_equity: e.est_equity, est_ltv: e.est_ltv, years_owned: e.years_owned,
        inputs: { ...f, rate_source: e.rate_source, rate_gap: e.rate_gap, tappable_80: e.tappable_80, orig_ltv: e.orig_ltv },
        computed_at: now.toISOString(),
      })

      const ca = (actsBy.get(c.id) ?? []).sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)))
      const lastAct = ca[0]?.occurred_at as string | undefined
      const lastContactAt = [lastAct, c.last_touch_at].filter(Boolean).sort().at(-1) ?? null
      const engaged = ca.find((a) => (a.type === 'call' && a.direction === 'inbound') || a.type === 'appointment')
      const lastPick = (picksBy.get(c.id) ?? []).map((x) => x.pick_date as string).sort().at(-1) ?? null
      const tags = ((raw.tags as string[]) ?? []).join(' ')
      const phones = ((raw.phones as { value?: string }[]) ?? []).map((x) => phone10(x.value ?? '')).filter((x) => x.length === 10)
      const householdKey = p?.address ? `addr:${normAddr(String(p.address))}${p.zip ?? ''}` : phones[0] ? `ph:${phones[0]}` : `c:${c.id}`

      candidates.push({
        contactId: c.id, householdKey,
        propertyState: (p?.state as string) ?? null,
        hasProperty: !!p?.address,
        recordingDate: f.recording_date,
        homestead: (p?.homestead as boolean) ?? null,
        parcelsOwned: (p?.parcels_owned as number) ?? null,
        keptPriorHome: !!p?.kept_prior_home,
        knownArm: cl.some((l) => /\barm\b|adjustable/i.test(String(l.loan_type ?? ''))),
        lastEngagementAt: (engaged?.occurred_at as string) ?? null,
        lastContactAt,
        lastPickedAt: lastPick,
        salesOsStage: c.stage_key,
        doNotContact: DNC.test(tags),
        snoozed: snoozed.has(c.id),
        activeLoan: cl.some((l) => ACTIVE_LOAN.includes(String(l.stage_group))),
        estimates: e,
      })
      const addr = ((raw.addresses as { city?: string }[]) ?? [])[0]
      facts.set(c.id, {
        firstName: String(raw.firstName ?? c.name ?? '').split(' ')[0] || 'there',
        city: (p?.city as string) ?? addr?.city ?? null,
        estimates: e,
        recentActivity: ca.slice(0, 3).map((a) => ({ type: String(a.type), date: String(a.occurred_at) })),
        hasProperty: !!p?.address,
        hasLoanAmount: f.orig_loan_amount != null,
        hasMarketValue: f.market_value != null,
      })
    }

    for (let i = 0; i < estimateRows.length; i += 500) {
      const { error } = await db.from('opportunity_estimates').upsert(estimateRows.slice(i, i + 500), { onConflict: 'contact_id' })
      if (error) throw new Error(`opportunity_estimates write: ${error.message}`)
    }

    const { count: existing } = await db.from('opportunity_picks').select('id', { count: 'exact', head: true }).eq('pick_date', today)
    if ((existing ?? 0) > 0) {
      await logSync(db, 'opportunity-nightly', 'ok', estimateRows.length, `estimates refreshed; ${existing} picks already set for ${today}`)
      return Response.json({ ok: true, today, picks: existing, estimates: estimateRows.length, skipped: true })
    }

    const count = picksForDate(new Date(`${today}T12:00:00Z`), cfg.picks_per_day ?? 5, cfg.picks_by_weekday ?? {})
    const picks = selectPicks(candidates, { now, count, checkInEvery: cfg.check_in_every ?? 5, config })

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    const ask = cfg.ai_enabled !== false && apiKey ? anthropicAsk(apiKey, Deno.env.get('OPPORTUNITY_MODEL') ?? 'claude-haiku-5-5') : null
    let rejections = 0, fallbacks = 0
    const rows = []
    for (const p of picks) {
      const rejected: string[][] = []
      const note = await makeNote(p, facts.get(p.contactId)!, ask, (probs) => { rejections++; rejected.push(probs) })
      if (note.fallback) fallbacks++
      rows.push({
        pick_date: today, contact_id: p.contactId, rank: p.rank, score: p.score, kind: p.kind,
        reason_codes: p.reasons, ai_note: rejected.length ? { ...note, rejections: rejected } : note, status: 'pending',
      })
    }
    if (rows.length) {
      const { error } = await db.from('opportunity_picks').upsert(rows, { onConflict: 'pick_date,contact_id', ignoreDuplicates: true })
      if (error) throw new Error(`opportunity_picks write: ${error.message}`)
    }

    const summary = `${today}: ${rows.length} picks (${rows.filter((r) => r.kind === 'check_in').length} check-ins), ${estimateRows.length} estimates, AI ${ask ? 'on' : 'off'}, ${rejections} note rejections, ${fallbacks} template notes`
    await logSync(db, 'opportunity-nightly', 'ok', rows.length, summary)
    return Response.json({ ok: true, today, picks: rows.length, estimates: estimateRows.length, rejections, fallbacks })
  } catch (err) {
    await logSync(db, 'opportunity-nightly', 'error', 0, String((err as Error)?.message || err))
    return Response.json({ ok: false, error: String((err as Error)?.message || err) }, { status: 500 })
  }
})
