// Classes tab on Partners: each class with its date, topic and host brokerage,
// and a roster of partners marked invited, registered, attended or no-show.
// Marking someone invited or attended moves their partner stage forward.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { showToast } from './Toaster'
import { friendlyError } from '../lib/friendlyError'
import { ROSTER_STATUSES, loadClasses, addClass, loadRoster, setRoster, removeFromRoster } from '../lib/classes'
import { STAGE_LABEL } from '../lib/partners'

const SEL = 'rounded-lg border border-line2 bg-transparent px-2 py-1 text-body'
const BTN = 'min-h-[36px] rounded-lg border border-line2 px-3 font-medium hover:bg-hoverbg disabled:opacity-50'

function NewClass({ onAdded }) {
  const [f, setF] = useState({ class_date: '', topic: '', host_brokerage: '', location: '' })
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await addClass(f)
      setF({ class_date: '', topic: '', host_brokerage: '', location: '' })
      onAdded()
    } catch (err) {
      showToast({ tone: 'error', text: friendlyError(err) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={save} className="flex flex-wrap items-center gap-2 text-body">
      <input type="date" aria-label="Class date" required value={f.class_date} onChange={set('class_date')} className={SEL} />
      <input aria-label="Topic" required placeholder="Topic" value={f.topic} onChange={set('topic')} className={`${SEL} min-w-[220px]`} />
      <input aria-label="Host brokerage" placeholder="Host brokerage" value={f.host_brokerage} onChange={set('host_brokerage')} className={SEL} />
      <input aria-label="Location" placeholder="Location" value={f.location} onChange={set('location')} className={SEL} />
      <button type="submit" disabled={busy} className={BTN}>Add class</button>
    </form>
  )
}

function Roster({ cls, partners, onChanged }) {
  const [rows, setRows] = useState(null)
  const [pick, setPick] = useState('')
  const reload = useCallback(async () => {
    try { setRows(await loadRoster(cls.id)) } catch (e) { setRows([]); showToast({ tone: 'error', text: friendlyError(e) }) }
  }, [cls.id])
  useEffect(() => { reload() }, [reload])

  const onRoster = useMemo(() => new Set((rows || []).map((r) => r.partner_id)), [rows])
  const choices = useMemo(() => (partners || []).filter((p) => !onRoster.has(p.id)).sort((a, b) => String(a.name).localeCompare(String(b.name))), [partners, onRoster])
  const byId = useMemo(() => new Map((partners || []).map((p) => [p.id, p])), [partners])

  const change = async (partner, status) => {
    try {
      const moved = await setRoster(cls.id, partner, status)
      if (moved) showToast({ tone: 'ok', text: `${partner.name} moved to ${STAGE_LABEL[moved]}` })
      await reload()
      onChanged()
    } catch (e) {
      showToast({ tone: 'error', text: friendlyError(e) })
    }
  }
  const remove = async (partnerId) => {
    try { await removeFromRoster(cls.id, partnerId); await reload(); onChanged() } catch (e) { showToast({ tone: 'error', text: friendlyError(e) }) }
  }

  if (!rows) return <p className="px-4 py-3 text-body text-muted">Loading roster…</p>
  return (
    <div data-roster={cls.id} className="border-t border-line px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Add partner" value={pick} onChange={(e) => setPick(e.target.value)} className={`${SEL} min-w-[240px]`}>
          <option value="">Add a partner…</option>
          {choices.map((p) => <option key={p.id} value={p.id}>{p.name}{p.brokerage ? ` (${p.brokerage})` : ''}</option>)}
        </select>
        <button type="button" disabled={!pick} onClick={() => { const p = byId.get(pick); setPick(''); if (p) change(p, 'invited') }} className={BTN}>Invite</button>
      </div>
      {rows.length ? (
        <ul className="mt-3 flex flex-col gap-1.5">
          {rows.map((r) => {
            const p = byId.get(r.partner_id) || { id: r.partner_id, name: r.partner?.name, partner_stage: r.partner?.partner_stage }
            return (
              <li key={r.partner_id} data-roster-row={r.partner_id} className="flex flex-wrap items-center gap-2 text-body">
                <span className="min-w-[180px] font-medium">{r.partner?.name}</span>
                <span className="text-muted">{r.partner?.brokerage || ''}</span>
                <select aria-label={`Status for ${r.partner?.name}`} value={r.status} onChange={(e) => change(p, e.target.value)} className={SEL}>
                  {ROSTER_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
                <button type="button" onClick={() => remove(r.partner_id)} className="px-2 text-muted hover:text-[color:var(--text)]">Remove</button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="mt-2 text-body text-muted">Nobody on the roster yet.</p>
      )}
    </div>
  )
}

export default function PartnerClasses({ partners, onPartnersChanged }) {
  const [classes, setClasses] = useState(null)
  const [open, setOpen] = useState(null)
  const reload = useCallback(async () => {
    try { setClasses(await loadClasses()) } catch (e) { setClasses([]); showToast({ tone: 'error', text: friendlyError(e) }) }
  }, [])
  useEffect(() => { reload() }, [reload])

  return (
    <div className="flex flex-col gap-4">
      <NewClass onAdded={reload} />
      {classes === null && <p className="text-body text-muted">Loading…</p>}
      {classes && !classes.length && <p className="text-body text-muted">No classes yet. Add the first one above.</p>}
      {classes?.map((c) => (
        <section key={c.id} data-class={c.id} className="cc-card overflow-hidden">
          <button type="button" onClick={() => setOpen(open === c.id ? null : c.id)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left text-body hover:bg-hoverbg">
            <span className="font-semibold">{c.class_date}</span>
            <span className="font-medium">{c.topic}</span>
            {c.host_brokerage && <span className="text-muted">at {c.host_brokerage}</span>}
            <span className="flex-1" />
            <span className="num text-muted">{c.counts.invited + c.counts.registered + c.counts.attended + c.counts.no_show} invited · {c.counts.registered + c.counts.attended} registered · {c.counts.attended} attended</span>
          </button>
          {open === c.id && <Roster cls={c} partners={partners} onChanged={() => { reload(); onPartnersChanged() }} />}
        </section>
      ))}
    </div>
  )
}
