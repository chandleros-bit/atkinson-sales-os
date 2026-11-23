// Bayway Partners (Bot Engine doc, Sales OS week 1): every agent at the FUB
// Realtors stage plus agents from Arive loans, with partner stage, type, last
// touch and next touch due. Stage, type and next touch are edited in place.
// On load it adds anyone new (sync_partner_profiles), never overwriting edits.
// Later weeks add the HAR import, scoring, the class tracker and the funnel card.
import { useCallback, useEffect, useMemo, useState } from 'react'
import PageHeader from '../components/PageHeader'
import PersonLink from '../components/PersonLink'
import { showToast } from '../components/Toaster'
import { isDemoMode } from '../lib/supabase'
import { friendlyError } from '../lib/friendlyError'
import {
  PARTNER_STAGES, PARTNER_TYPES, STAGE_LABEL, SOURCE_LABEL, QUIET_DAYS,
  stageCounts, filterPartners, sortPartners, lastTouchText, touchStatus,
  syncPartners, loadPartners, updatePartner, addPartner, scoreRanks, sortByScore,
} from '../lib/partners'
import { tierFor } from '../lib/harImport'
import HarImport from '../components/HarImport'
import PartnerClasses from '../components/PartnerClasses'

const SEL = 'rounded-lg border border-line2 bg-transparent px-2 py-1 text-body'
const fubUrl = (id) => (id ? `https://baywayhtx.followupboss.com/2/people/view/${id}` : null)

function StageStrip({ counts, total, value, onChange }) {
  const items = [{ key: 'all', label: 'All', n: total }, ...PARTNER_STAGES.map((s) => ({ ...s, n: counts[s.key] }))]
  return (
    <div role="group" aria-label="Partner stage" className="flex flex-wrap gap-2">
      {items.map((s) => (
        <button key={s.key} type="button" aria-pressed={value === s.key} data-stage-filter={s.key} onClick={() => onChange(s.key)}
          className={`min-h-[32px] rounded-full border px-3 text-body ${value === s.key ? 'border-[color:var(--text)] font-semibold' : 'border-line2 text-muted hover:bg-hoverbg'}`}>
          {s.label} <span className="num">{s.n}</span>
        </button>
      ))}
    </div>
  )
}

function AddBox({ onAdded }) {
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ name: '', brokerage: '', email: '', phone: '', partner_type: 'realtor' })
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await addPartner(f)
      setF({ name: '', brokerage: '', email: '', phone: '', partner_type: 'realtor' })
      setOpen(false)
      onAdded()
    } catch (err) {
      showToast({ tone: 'error', text: friendlyError(err) })
    } finally {
      setBusy(false)
    }
  }
  if (!open) return (
    <button type="button" onClick={() => setOpen(true)} className="min-h-[36px] rounded-lg border border-line2 px-3 font-medium hover:bg-hoverbg">Add partner</button>
  )
  return (
    <form onSubmit={save} className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-panel p-3 text-body">
      <input required placeholder="Name" value={f.name} onChange={set('name')} className={SEL} />
      <input placeholder="Brokerage" value={f.brokerage} onChange={set('brokerage')} className={SEL} />
      <input type="email" placeholder="Email" value={f.email} onChange={set('email')} className={SEL} />
      <input placeholder="Phone" value={f.phone} onChange={set('phone')} className={SEL} />
      <select value={f.partner_type} onChange={set('partner_type')} className={SEL}>
        {PARTNER_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
      </select>
      <button type="submit" disabled={busy} className="min-h-[36px] rounded-lg border border-line2 px-3 font-medium hover:bg-hoverbg disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
      <button type="button" onClick={() => setOpen(false)} className="min-h-[36px] px-2 text-muted">Cancel</button>
    </form>
  )
}

function Row({ p, rank, onSaved }) {
  const [busy, setBusy] = useState(false)
  const save = async (field, value) => {
    setBusy(true)
    try {
      const patch = await updatePartner(p.id, field, value)
      onSaved(p.id, patch)
    } catch (e) {
      showToast({ tone: 'error', text: friendlyError(e) })
    } finally {
      setBusy(false)
    }
  }
  const status = touchStatus(p)
  return (
    <tr data-partner={p.id} className="border-t border-line align-top">
      <td className="py-1.5 pr-3">
        <PersonLink id={p.contact_id} url={fubUrl(p.fub_id)}>{p.name}</PersonLink>
        <div className="text-xs text-dim">{SOURCE_LABEL[p.source] || p.source}</div>
      </td>
      <td className="pr-3 text-muted">{p.brokerage || ''}</td>
      <td data-score className="num pr-3 text-right">
        {p.score != null ? Number(p.score).toFixed(1) : ''}
        {tierFor(rank) && <div className="text-xs text-dim">{tierFor(rank)} #{rank}</div>}
      </td>
      <td className="num pr-3 text-right">{p.closings_12mo ?? ''}</td>
      <td className="pr-3">
        <select aria-label="Type" value={p.partner_type} disabled={busy} onChange={(e) => save('partner_type', e.target.value)} className={SEL}>
          {PARTNER_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
      </td>
      <td className="pr-3">
        <select aria-label="Stage" value={p.partner_stage} disabled={busy} onChange={(e) => save('partner_stage', e.target.value)} className={SEL}>
          {PARTNER_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </td>
      <td className={`pr-3 ${status === 'quiet' ? 'text-warn-ink' : ''}`} data-touch={status}>{lastTouchText(p.last_touch_at)}</td>
      <td className="pr-3">
        <input type="date" aria-label="Next touch" value={p.next_touch_due || ''} disabled={busy}
          onChange={(e) => save('next_touch_due', e.target.value)}
          className={`${SEL} ${status === 'due' ? 'border-[color:var(--text)] font-semibold' : ''}`} />
      </td>
      <td className="num text-right">{p.loans_sent ? `${p.loans_sent}${p.loans_funded ? ` · ${p.loans_funded} funded` : ''}` : ''}</td>
    </tr>
  )
}

export default function Partners() {
  const [rows, setRows] = useState(null)
  const [stage, setStage] = useState('all')
  const [type, setType] = useState('all')
  const [q, setQ] = useState('')
  const [due, setDue] = useState(false)
  const [sortBy, setSortBy] = useState('stage')
  const [importing, setImporting] = useState(false)
  const [view, setView] = useState('list')

  const reload = useCallback(async ({ sync = false } = {}) => {
    try {
      if (sync) {
        const added = await syncPartners()
        if (added) showToast({ tone: 'ok', text: `${added} new partner${added === 1 ? '' : 's'} added` })
      }
      setRows(await loadPartners())
    } catch (e) {
      setRows((r) => r || [])
      showToast({ tone: 'error', text: friendlyError(e) })
    }
  }, [])
  useEffect(() => { reload({ sync: true }) }, [reload])

  const onSaved = (id, patch) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  const counts = useMemo(() => stageCounts(rows), [rows])
  const ranks = useMemo(() => scoreRanks(rows), [rows])
  const shown = useMemo(() => {
    const list = filterPartners(rows, { stage, type, q, due })
    return sortBy === 'score' ? sortByScore(list) : sortPartners(list)
  }, [rows, stage, type, q, due, sortBy])

  return (
    <div className="flex flex-col gap-4 pt-4">
      <PageHeader eyebrow="Bayway" title="Partners" subtitle="Agents and referral partners: where each one stands and when you last reached out." />
      {isDemoMode && <p className="text-body text-muted">Connect Supabase to see partners.</p>}
      {!isDemoMode && rows === null && <p className="text-body text-muted">Loading…</p>}
      {!isDemoMode && rows && (
        <div role="tablist" className="flex gap-2">
          {[['list', 'Partners'], ['classes', 'Classes']].map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={view === k} data-view={k} onClick={() => setView(k)}
              className={`min-h-[32px] rounded-full border px-3 text-body ${view === k ? 'border-[color:var(--text)] font-semibold' : 'border-line2 text-muted hover:bg-hoverbg'}`}>
              {label}
            </button>
          ))}
        </div>
      )}
      {!isDemoMode && rows && view === 'classes' && <PartnerClasses partners={rows} onPartnersChanged={() => reload()} />}
      {!isDemoMode && rows && view === 'list' && (
        <>
          <StageStrip counts={counts} total={rows.length} value={stage} onChange={setStage} />
          <div className="flex flex-wrap items-center gap-2">
            <input type="search" placeholder="Search name, brokerage, email" value={q} onChange={(e) => setQ(e.target.value)} className={`${SEL} min-w-[220px]`} />
            <select aria-label="Partner type" value={type} onChange={(e) => setType(e.target.value)} className={SEL}>
              <option value="all">All types</option>
              {PARTNER_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
            <label className="flex items-center gap-1.5 text-body text-muted">
              <input type="checkbox" checked={due} onChange={(e) => setDue(e.target.checked)} />
              Due or quiet {QUIET_DAYS}+ days
            </label>
            <select aria-label="Sort" value={sortBy} onChange={(e) => setSortBy(e.target.value)} className={SEL}>
              <option value="stage">Sort: stage</option>
              <option value="score">Sort: score</option>
            </select>
            <span className="flex-1" />
            <button type="button" data-har-import onClick={() => setImporting(true)} className="min-h-[36px] rounded-lg border border-line2 px-3 font-medium hover:bg-hoverbg">Import HAR CSV</button>
            <AddBox onAdded={() => reload()} />
          </div>
          {!shown.length ? (
            <p className="text-body text-muted">{rows.length ? 'No partners match.' : 'No partners yet. Contacts at the Realtors stage in FUB show up here after the next sync.'}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-body">
                <thead>
                  <tr className="text-left text-xs text-dim">
                    <th className="py-1 pr-3">Name</th><th className="pr-3">Brokerage</th><th className="pr-3 text-right">Score</th><th className="pr-3 text-right">12-mo closings</th><th className="pr-3">Type</th>
                    <th className="pr-3">Stage</th><th className="pr-3">Last touch</th><th className="pr-3">Next touch</th>
                    <th className="text-right">Loans</th>
                  </tr>
                </thead>
                <tbody>{shown.map((p) => <Row key={p.id} p={p} rank={ranks.get(p.id)} onSaved={onSaved} />)}</tbody>
              </table>
            </div>
          )}
          {importing && (
            <HarImport partners={rows} onClose={() => setImporting(false)}
              onImported={(c) => { setImporting(false); setSortBy('score'); showToast({ tone: 'ok', text: `${c.new} added, ${c.updated} updated from HAR` }); reload() }} />
          )}
          <p className="text-xs text-dim">{shown.length} of {rows.length} shown. {STAGE_LABEL.dream_20} and {STAGE_LABEL.top_partner} start from your FUB tags.</p>
        </>
      )}
    </div>
  )
}
