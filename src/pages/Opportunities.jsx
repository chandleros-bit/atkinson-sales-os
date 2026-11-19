// Bayway Opportunities (Database Opportunity Agent, spec "Sales OS UI").
// Today: the daily past-client picks as cards with the call-prep note and
// quick actions. History: every pick and its outcome. Review: medium-
// confidence property matches to accept or reject. Coverage: how much of the
// past-client list has property data and how much was touched lately.
// Every estimate is labeled "Estimate" with its source and date.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import PersonLink from '../components/PersonLink'
import { showToast } from '../components/Toaster'
import { isDemoMode } from '../lib/supabase'
import { friendlyError } from '../lib/friendlyError'
import {
  OUTCOMES, REASON_LABEL, centralToday, isStale, loadPicks, loadEstimates, logOutcome,
  loadReviews, decideReview, loadCoverage, IMPORT_SOURCES, importMatchFile,
} from '../lib/opportunities'

const TABS = [
  { id: 'today', label: 'Today' },
  { id: 'history', label: 'History' },
  { id: 'review', label: 'Review' },
  { id: 'coverage', label: 'Coverage' },
]
const STATUS_LABEL = { pending: 'Pending', connected: 'Connected', no_answer: 'No answer', skipped: 'Skipped', not_a_fit: 'Not a fit', called: 'Called' }
const SOURCE_LABEL = { arive: 'Arive', title_rep: 'title rep', hcad: 'Harris County', fbcad: 'Fort Bend County', mcad: 'Montgomery County', paid: 'paid data', manual: 'manual' }

const money = (n) => (n == null ? null : `$${Math.round(Number(n) / 1000).toLocaleString()}k`)
const nameOf = (c) => c?.name || [c?.raw?.firstName, c?.raw?.lastName].filter(Boolean).join(' ') || 'Unknown'

function Chips({ codes }) {
  if (!codes?.length) return <span className="rounded-full border border-line2 px-2 py-0.5 text-xs text-muted">Check-in</span>
  return (
    <span className="flex flex-wrap gap-1">
      {codes.map((c) => (
        <span key={c} className="rounded-full border border-line2 px-2 py-0.5 text-xs text-muted">{REASON_LABEL[c] || c}</span>
      ))}
    </span>
  )
}

function List({ title, items }) {
  if (!items?.length) return null
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-dim">{title}</div>
      <ul className="mt-1 list-disc pl-5 text-body">
        {items.map((x, i) => <li key={i}>{x}</li>)}
      </ul>
    </div>
  )
}

function Estimates({ info }) {
  const e = info?.estimate
  const p = info?.property
  if (!e && !p) return <p className="text-xs text-muted">No property matched yet.</p>
  const src = p?.source ? SOURCE_LABEL[p.source] || p.source : 'Arive'
  const asOf = e?.computed_at ? new Date(e.computed_at).toLocaleDateString() : null
  const rows = [
    p?.address && ['Property', [p.address, p.city].filter(Boolean).join(', ')],
    e?.est_rate != null && ['Rate at purchase', `${Number(e.est_rate).toFixed(3)}%`],
    e?.est_value != null && ['Value', money(e.est_value)],
    e?.est_balance != null && ['Balance', money(e.est_balance)],
    e?.est_equity != null && ['Equity', money(e.est_equity)],
    e?.years_owned != null && ['Owned', `${Number(e.years_owned).toFixed(1)} years`],
  ].filter(Boolean)
  return (
    <div className="rounded-lg bg-[color:var(--chrome-soft)] p-3 text-xs">
      <div className="mb-1 font-semibold text-dim">Estimate · {src}{asOf ? ` · ${asOf}` : ''}</div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        {rows.map(([k, v]) => (
          <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="num">{v}</dd></div>
        ))}
      </dl>
      <p className="mt-1 text-dim">For ranking only. Never quote these numbers.</p>
    </div>
  )
}

function PickCard({ pick, info, onLogged }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const n = pick.ai_note || {}
  const done = pick.status !== 'pending'
  const log = async (outcome) => {
    if (busy) return
    setBusy(true)
    try {
      const res = await logOutcome(pick, outcome, note)
      if (!res.ok) showToast({ tone: 'error', text: `Not saved: ${res.error}` })
      else {
        showToast({ tone: 'ok', text: res.fub === 'ok' ? 'Logged and noted in FUB' : 'Logged (FUB write-back is off)' })
        onLogged()
      }
    } catch (e) {
      showToast({ tone: 'error', text: friendlyError(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <article className="rounded-card border border-line bg-panel p-4" data-pick={pick.id}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-xs text-dim">#{pick.rank} · {pick.kind === 'check_in' ? 'Relationship check-in' : 'Mortgage review'}{n.fallback ? ' · template note' : ''}</div>
          <h3 className="text-ui font-semibold">
            <PersonLink id={pick.contact_id}>{nameOf(pick.contacts)}</PersonLink>
          </h3>
          <p className="text-body">{n.headline}</p>
        </div>
        <Chips codes={pick.reason_codes} />
      </header>
      <div className="mt-3 grid gap-3 md:grid-cols-[1fr_260px]">
        <div className="flex flex-col gap-2">
          <List title="Why now" items={n.why_now} />
          <List title="Known" items={n.known} />
          <List title="Find out" items={n.unknown} />
          {n.opener && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-dim">Opener</div>
              <p className="text-body italic">{n.opener}</p>
            </div>
          )}
          {n.channel && <p className="text-xs text-muted">Channel: {n.channel}</p>}
          <List title="Don't say" items={n.do_not_say} />
        </div>
        <Estimates info={info} />
      </div>
      {done ? (
        <p className="mt-3 text-body font-semibold">{STATUS_LABEL[pick.status]}{pick.outcome_note ? `: ${pick.outcome_note}` : ''}</p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Note for FUB (optional)"
            className="w-full rounded-lg border border-line2 bg-transparent p-2 text-body"
          />
          <div className="flex flex-wrap gap-2">
            {OUTCOMES.map((o) => (
              <button key={o.key} type="button" disabled={busy} onClick={() => log(o.key)}
                className="min-h-[36px] rounded-lg border border-line2 px-3 text-body font-medium hover:bg-hoverbg disabled:opacity-50">
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </article>
  )
}

function TodayTab({ picks, infos, reload, today }) {
  const list = picks.filter((p) => p.pick_date === today || (p.status === 'pending' && !isStale(p, today)))
  if (!list.length) return <p className="text-body text-muted">No picks for today yet. The list is built each weekday before the 7:30 AM briefing.</p>
  return <div className="flex flex-col gap-3">{list.map((p) => <PickCard key={p.id} pick={p} info={infos.get(p.contact_id)} onLogged={reload} />)}</div>
}

function HistoryTab({ picks }) {
  if (!picks.length) return <p className="text-body text-muted">No picks yet.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-body">
        <thead><tr className="text-left text-xs text-dim"><th className="py-1 pr-3">Date</th><th className="pr-3">Name</th><th className="pr-3">Why</th><th className="pr-3">Outcome</th><th>Note</th></tr></thead>
        <tbody>
          {picks.map((p) => (
            <tr key={p.id} className="border-t border-line align-top">
              <td className="num py-1.5 pr-3">{p.pick_date}</td>
              <td className="pr-3"><PersonLink id={p.contact_id}>{nameOf(p.contacts)}</PersonLink></td>
              <td className="pr-3"><Chips codes={p.reason_codes} /></td>
              <td className="pr-3">{STATUS_LABEL[p.status] || p.status}</td>
              <td className="text-muted">{p.outcome_note || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Upload a filled-in past_client_match_file.csv (title rep or county match).
function ImportBox({ onDone }) {
  const [source, setSource] = useState('hcad')
  const [busy, setBusy] = useState(false)
  const run = async (file) => {
    if (!file || busy) return
    setBusy(true)
    try {
      const res = await importMatchFile(source, await file.text())
      if (!res?.ok) showToast({ tone: 'error', text: `Import failed: ${res?.error || 'unknown error'}` })
      else {
        showToast({ tone: 'ok', text: `${res.accepted} saved, ${res.review} to review, ${res.dropped} not matched` })
        onDone()
      }
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-panel p-3 text-body">
      <span className="font-semibold">Import match file</span>
      <select value={source} onChange={(e) => setSource(e.target.value)} className="rounded-lg border border-line2 bg-transparent px-2 py-1">
        {IMPORT_SOURCES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
      </select>
      <label className="cursor-pointer rounded-lg border border-line2 px-3 py-1 font-medium hover:bg-hoverbg">
        {busy ? 'Importing…' : 'Choose CSV'}
        <input type="file" accept=".csv,text/csv" className="hidden" disabled={busy}
          onChange={(e) => { run(e.target.files?.[0]); e.target.value = '' }} />
      </label>
      <span className="text-xs text-muted">Sure matches are saved; possible ones show up below.</span>
    </div>
  )
}

function ReviewTab() {
  const [rows, setRows] = useState(null)
  const [busy, setBusy] = useState(null)
  const load = useCallback(() => loadReviews().then(setRows, (e) => showToast({ tone: 'error', text: friendlyError(e) })), [])
  useEffect(() => { load() }, [load])
  const decide = async (r, d) => {
    setBusy(r.id)
    try {
      await decideReview(r, d)
      setRows((x) => x.filter((y) => y.id !== r.id))
    } catch (e) {
      showToast({ tone: 'error', text: friendlyError(e) })
    } finally {
      setBusy(null)
    }
  }
  if (!rows) return <p className="text-body text-muted">Loading…</p>
  if (!rows.length) return (
    <div className="flex flex-col gap-2">
      <ImportBox onDone={load} />
      <p className="text-body text-muted">Nothing to review.</p>
    </div>
  )
  return (
    <div className="flex flex-col gap-2">
      <ImportBox onDone={load} />
      <p className="text-xs text-muted">{rows.length} possible matches. Accept saves the property; reject drops it.</p>
      {rows.map((r) => {
        const c = r.candidate || {}
        return (
          <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-line bg-panel p-3">
            <div className="text-body">
              <PersonLink id={r.contact_id}>{nameOf(r.contacts)}</PersonLink>
              <div className="text-muted">{[c.address, c.city, c.zip].filter(Boolean).join(', ')}{c.recording_date ? ` · bought ${c.recording_date}` : ''}{c.market_value ? ` · ${money(c.market_value)}` : ''}</div>
              {c.note && <div className="text-xs text-dim">{c.note}</div>}
            </div>
            <div className="flex gap-2">
              <button type="button" disabled={busy === r.id} onClick={() => decide(r, 'accept')} className="min-h-[36px] rounded-lg border border-line2 px-3 font-medium hover:bg-hoverbg disabled:opacity-50">Accept</button>
              <button type="button" disabled={busy === r.id} onClick={() => decide(r, 'reject')} className="min-h-[36px] rounded-lg border border-line2 px-3 text-muted hover:bg-hoverbg disabled:opacity-50">Reject</button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function CoverageTab() {
  const [c, setC] = useState(null)
  useEffect(() => { loadCoverage().then(setC, (e) => showToast({ tone: 'error', text: friendlyError(e) })) }, [])
  if (!c) return <p className="text-body text-muted">Loading…</p>
  const pct = (n) => (c.total ? `${Math.round((n / c.total) * 100)}%` : '0%')
  const rows = [
    ['Past clients', c.total.toLocaleString(), ''],
    ['With property data', c.withProperty.toLocaleString(), pct(c.withProperty)],
    ['Touched in the last 90 days', c.touched90.toLocaleString(), pct(c.touched90)],
    ['Touched in the last 180 days', c.touched180.toLocaleString(), pct(c.touched180)],
    ['Matches waiting for review', c.pendingReview.toLocaleString(), ''],
  ]
  return (
    <table className="w-full max-w-lg text-body">
      <tbody>
        {rows.map(([k, v, p]) => (
          <tr key={k} className="border-t border-line"><td className="py-1.5 pr-3">{k}</td><td className="num pr-3 text-right">{v}</td><td className="num text-right text-muted">{p}</td></tr>
        ))}
      </tbody>
    </table>
  )
}

export default function Opportunities() {
  const [params, setParams] = useSearchParams()
  const tab = TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'today'
  const [picks, setPicks] = useState(null)
  const [infos, setInfos] = useState(new Map())
  const today = useMemo(() => centralToday(), [])

  const reload = useCallback(async () => {
    try {
      const p = await loadPicks()
      setPicks(p)
      const ids = [...new Set(p.filter((x) => x.status === 'pending' || x.pick_date === today).map((x) => x.contact_id))]
      setInfos(await loadEstimates(ids))
    } catch (e) {
      setPicks([])
      showToast({ tone: 'error', text: friendlyError(e) })
    }
  }, [today])
  useEffect(() => { reload() }, [reload])

  return (
    <div className="flex flex-col gap-4 pt-4">
      <PageHeader eyebrow="Bayway" title="Opportunities" subtitle="Past clients worth a call today, with why and what to say." />
      <div role="tablist" aria-label="Opportunities" className="flex gap-5 border-b border-line">
        {TABS.map((t) => (
          <button key={t.id} role="tab" type="button" aria-selected={tab === t.id}
            onClick={() => setParams(t.id === 'today' ? {} : { tab: t.id }, { replace: true })}
            className={`-mb-px border-b-2 pb-2 text-body ${tab === t.id ? 'border-[color:var(--text)] font-semibold' : 'border-transparent text-muted'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {isDemoMode && <p className="text-body text-muted">Connect Supabase to see past-client picks.</p>}
      {!isDemoMode && picks === null && tab !== 'review' && tab !== 'coverage' && <p className="text-body text-muted">Loading…</p>}
      {!isDemoMode && picks && tab === 'today' && <TodayTab picks={picks} infos={infos} reload={reload} today={today} />}
      {!isDemoMode && picks && tab === 'history' && <HistoryTab picks={picks} />}
      {!isDemoMode && tab === 'review' && <ReviewTab />}
      {!isDemoMode && tab === 'coverage' && <CoverageTab />}
    </div>
  )
}
