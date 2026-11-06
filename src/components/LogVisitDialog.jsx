// Log a walk-in visit (MPG). Saves to the OS touch log only; a visit to a
// business that is already a Zoho lead also drops a Zoho note (and a follow-up
// task). Promotion of new businesses to Zoho comes in slice 2.
// Spec: docs/superpowers/specs/2026-11-05-mpg-tracker-touch-log-design.md
import { useEffect, useState } from 'react'
import { buildVisit, zohoVisitNote, OUTCOMES, TEMPERATURES } from '../lib/mpgTracker'
import { searchMpgBusinesses, saveVisit, updateTouch, deleteTouch, notifyTouchesChanged } from '../lib/mpgTouches'
import { localDateKey, buildActionRequest } from '../lib/crmActions'
import { useWritebackFlags, invokeCrmAction } from '../lib/writeback'
import { showToast } from './Toaster'

const INPUT = 'w-full rounded-[10px] border border-line2 bg-panel px-3 py-2 text-[13px] text-[color:var(--text)]'
const LABEL = 'mb-1 block text-[12px] font-semibold text-muted'

function splitLabel(label) {
  const [name, role] = String(label || '').split(' / ')
  return { name: name || '', role: role || '' }
}

function emptyForm(now) {
  return {
    dayKey: localDateKey(now), contactName: '', role: '', phone: '', email: '', notes: '', nextStep: '',
    followUpOn: '', temperature: null, outcomes: {},
  }
}

function formFromTouch(t) {
  const { name, role } = splitLabel(t.contact_label)
  return {
    dayKey: localDateKey(new Date(t.occurred_at)), contactName: name, role, phone: t.reach_label || '', email: '',
    notes: t.notes || '', nextStep: t.next_step || '', followUpOn: t.follow_up_on || '',
    temperature: t.temperature, outcomes: Object.fromEntries(OUTCOMES.map((o) => [o.key, !!t[o.key]])),
  }
}

async function writeZoho(contactId, touch, followUpOn, nextStep) {
  const requests = [buildActionRequest({ action: 'add_note', contactId, subject: 'Walk-in', body: zohoVisitNote(touch) })]
  if (followUpOn) {
    requests.push(buildActionRequest({ action: 'create_task', contactId, dueDate: followUpOn, title: nextStep || 'Follow up', type: 'Follow Up' }))
  }
  for (const req of requests) {
    const res = await invokeCrmAction(req)
    if (res?.status !== 'ok') {
      showToast({
        tone: 'error',
        text: `Visit saved, but the Zoho ${req.action === 'add_note' ? 'note' : 'task'} failed: ${res?.error || 'unknown error'}`,
        retry: () => writeZoho(contactId, touch, followUpOn, nextStep),
      })
      return
    }
  }
}

export default function LogVisitDialog({ onClose, preset = null, touch = null }) {
  const writeback = useWritebackFlags()
  const [business, setBusiness] = useState(() => (touch ? { type: 'edit', name: touch.business_name } : preset))
  const [form, setForm] = useState(() => {
    if (touch) return formFromTouch(touch)
    const f = emptyForm(new Date())
    return preset ? { ...f, contactName: preset.contactName || '', role: preset.role || '', phone: preset.phone || '', email: preset.email || '' } : f
  })
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [problem, setProblem] = useState(null)
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (business) return undefined
    let alive = true
    const id = setTimeout(async () => {
      const rows = await searchMpgBusinesses(query)
      if (alive) setResults(rows)
    }, 250)
    return () => {
      alive = false
      clearTimeout(id)
    }
  }, [query, business])

  function pick(b) {
    setBusiness(b)
    setForm((f) => ({ ...f, contactName: b.contactName || f.contactName, role: b.role || f.role, phone: b.phone || f.phone, email: b.email || f.email }))
  }

  async function save() {
    setProblem(null)
    let built
    try {
      built = buildVisit({ ...form, business })
    } catch (e) {
      setProblem(e.message)
      return
    }
    setSaving(true)
    const { error } = touch ? await updateTouch(touch.id, built.touch) : await saveVisit(built)
    setSaving(false)
    if (error) {
      setProblem(error.message)
      return
    }
    notifyTouchesChanged()
    showToast({ tone: 'ok', text: touch ? 'Visit updated' : 'Visit logged' })
    onClose()
    if (!touch && business.type === 'contact' && writeback.mpg === true) {
      await writeZoho(business.id, built.touch, built.touch.follow_up_on, built.touch.next_step)
    }
  }

  async function remove() {
    if (!window.confirm('Delete this visit?')) return
    const { error } = await deleteTouch(touch.id)
    if (error) return setProblem(error.message)
    notifyTouchesChanged()
    showToast({ tone: 'ok', text: 'Visit deleted' })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={touch ? 'Edit visit' : 'Log visit'}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl border border-line bg-panel p-5 sm:max-w-md sm:rounded-card"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="text-[15px] font-bold">{touch ? 'Edit visit' : 'Log visit'}</div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-10 w-10 place-items-center rounded-[10px] text-muted hover:bg-hoverbg">✕</button>
        </div>

        {!business ? (
          <div>
            <label className={LABEL}>
              Business
              <input className={INPUT} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search or type a new business" autoFocus />
            </label>
            <div className="mt-2 flex flex-col">
              {results.map((r) => (
                <button key={`${r.type}:${r.id}`} type="button" onClick={() => pick(r)} className="flex min-h-[40px] items-center gap-2 rounded-[10px] px-2 text-left text-[13px] hover:bg-hoverbg">
                  <span className="truncate font-semibold">{r.name}</span>
                  <span className="truncate text-muted">· {r.sub}</span>
                </button>
              ))}
              {query.trim().length >= 2 && (
                <button type="button" onClick={() => pick({ type: 'new', name: query.trim() })} className="flex min-h-[40px] items-center rounded-[10px] px-2 text-left text-[13px] font-semibold hover:bg-hoverbg">
                  Add new business: {query.trim()}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="mb-3 flex items-center justify-between rounded-[10px] border border-line2 px-3 py-2 text-[13px]">
            <span className="truncate font-semibold">{business.name}</span>
            {!touch && !preset && (
              <button type="button" onClick={() => setBusiness(null)} className="text-[12px] text-muted hover:text-[color:var(--text)]">Change</button>
            )}
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className={LABEL}>Visit date<input type="date" className={INPUT} value={form.dayKey} onChange={set('dayKey')} /></label>
          <label className={LABEL}>Follow-up date<input type="date" className={INPUT} value={form.followUpOn} onChange={set('followUpOn')} /></label>
          <label className={LABEL}>Contact name<input className={INPUT} value={form.contactName} onChange={set('contactName')} /></label>
          <label className={LABEL}>Role<input className={INPUT} value={form.role} onChange={set('role')} /></label>
          <label className={LABEL}>Phone<input type="tel" className={INPUT} value={form.phone} onChange={set('phone')} /></label>
          <label className={LABEL}>Email<input type="email" className={INPUT} value={form.email} onChange={set('email')} /></label>
        </div>
        <label className={`${LABEL} mt-3`}>Notes<textarea rows={3} className={INPUT} value={form.notes} onChange={set('notes')} /></label>
        <label className={`${LABEL} mt-3`}>Next step<input className={INPUT} value={form.nextStep} onChange={set('nextStep')} /></label>

        <div className="mt-3">
          <div className={LABEL}>Prospect quality</div>
          <div className="flex gap-2">
            {TEMPERATURES.map((t) => (
              <button
                key={t.key}
                type="button"
                aria-pressed={form.temperature === t.key}
                onClick={() => setForm((f) => ({ ...f, temperature: f.temperature === t.key ? null : t.key }))}
                className={`min-h-[40px] flex-1 rounded-[10px] border text-[13px] font-semibold ${form.temperature === t.key ? 'border-[color:var(--text)]' : 'border-line2 text-muted'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-1">
          {OUTCOMES.map((o) => (
            <label key={o.key} className="flex min-h-[36px] items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={!!form.outcomes[o.key]}
                onChange={(e) => setForm((f) => ({ ...f, outcomes: { ...f.outcomes, [o.key]: e.target.checked } }))}
              />
              {o.label}
            </label>
          ))}
        </div>

        {problem && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{problem}</div>}

        <div className="mt-4 flex gap-2">
          {touch && (
            <button type="button" onClick={remove} className="min-h-[44px] rounded-[10px] border border-line2 px-4 text-[13px] text-muted">Delete</button>
          )}
          <button type="button" disabled={saving} onClick={save} className="btn-primary min-h-[44px] flex-1 rounded-[10px] text-[14px] font-semibold">
            {saving ? 'Saving…' : 'Save visit'}
          </button>
        </div>
      </div>
    </div>
  )
}
