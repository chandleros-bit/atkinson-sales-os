// Log a walk-in visit (MPG). Saves to the OS touch log; a visit to a business
// that is already a Zoho lead also drops a Zoho note (and a follow-up task),
// and a new interested business can be promoted to Zoho as an Open lead (the
// ZohoPromote step replaces the form after Save).
// Spec: docs/superpowers/specs/2026-11-05-mpg-tracker-touch-log-design.md
import { useEffect, useRef, useState } from 'react'
import { buildVisit, zohoVisitNote, promotionDefault, OUTCOMES, TEMPERATURES } from '../lib/mpgTracker'
import { searchMpgBusinesses, saveVisit, updateTouch, deleteTouch, notifyTouchesChanged } from '../lib/mpgTouches'
import { localDateKey, buildActionRequest } from '../lib/crmActions'
import { useWritebackFlags, useSettingFlags, invokeCrmAction } from '../lib/writeback'
import { showToast } from './Toaster'
import ZohoPromote from './ZohoPromote'

const INPUT = 'w-full rounded-[10px] border border-line2 bg-panel px-3 py-2 text-[16px] sm:text-[13px] text-[color:var(--text)]'
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
  const parts = String(t.reach_label || '').split(' / ').map((x) => x.trim()).filter(Boolean)
  const email = parts.find((x) => x.includes('@')) || ''
  const phone = parts.find((x) => !x.includes('@')) || ''
  return {
    dayKey: localDateKey(new Date(t.occurred_at)), contactName: name, role, phone, email,
    notes: t.notes || '', nextStep: t.next_step || '', followUpOn: t.follow_up_on || '',
    temperature: t.temperature, outcomes: Object.fromEntries(OUTCOMES.map((o) => [o.key, !!t[o.key]])),
  }
}

// forms: the objects passed to buildActionRequest. Sent in order; on failure
// Retry resends only the failed form and those after it (each rebuilt, so it
// gets a fresh client_action_id).
async function writeZoho(forms) {
  for (let i = 0; i < forms.length; i++) {
    const req = buildActionRequest(forms[i])
    const res = await invokeCrmAction(req)
    if (res?.status !== 'ok') {
      showToast({
        tone: 'error',
        text: `Visit saved, but the Zoho ${forms[i].action === 'add_note' ? 'note' : 'task'} failed: ${res?.error || 'unknown error'}`,
        retry: () => writeZoho(forms.slice(i)),
      })
      return
    }
  }
}

export default function LogVisitDialog({ onClose, preset = null, touch = null }) {
  const writeback = useWritebackFlags()
  const createLead = useSettingFlags('create_lead_enabled')
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
  const [zohoChoice, setZohoChoice] = useState(null) // null = follow the default
  const [promoting, setPromoting] = useState(null) // the saved touch, while ZohoPromote runs
  const downOnBackdrop = useRef(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  useEffect(() => {
    // Capture phase + stopPropagation: Esc closes only this dialog, not the
    // person sheet underneath (its Escape listener is bubble-phase).
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
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

  const canPromote = !touch && (business?.type === 'new' || business?.type === 'prospect')
    && writeback.mpg === true && createLead.mpg === true
  const promo = promotionDefault({ temperature: form.temperature, outcomes: form.outcomes })
  const zohoOn = promo.forced || (zohoChoice ?? promo.on)

  function pick(b) {
    setBusiness(b)
    setForm((f) => ({ ...f, contactName: b.contactName || '', role: b.role || '', phone: b.phone || '', email: b.email || '' }))
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
    if (touch && form.dayKey === localDateKey(new Date(touch.occurred_at))) delete built.touch.occurred_at
    const wantZoho = canPromote && zohoOn
    const { data: saved, error, prospectId } = touch
      ? await updateTouch(touch.id, built.touch)
      : await saveVisit(wantZoho ? { ...built, zohoWanted: true } : built)
    setSaving(false)
    if (prospectId) setBusiness({ type: 'prospect', id: prospectId, name: business.name })
    if (error) {
      setProblem(error.message)
      return
    }
    notifyTouchesChanged()
    showToast({ tone: 'ok', text: touch ? 'Visit updated' : 'Visit logged' })
    if (wantZoho && saved?.prospect_id) {
      // The visit is saved; swap the form for the promotion step. It closes
      // the dialog when done, and Escape/backdrop still close it meanwhile.
      setPromoting(saved)
      return
    }
    onClose()
    if (!touch && business.type === 'contact' && writeback.mpg === true) {
      const forms = [{ action: 'add_note', contactId: business.id, subject: 'Walk-in', body: zohoVisitNote(built.touch) }]
      if (built.touch.follow_up_on) {
        forms.push({
          action: 'create_task', contactId: business.id, dueDate: built.touch.follow_up_on,
          title: built.touch.next_step || 'Follow up', type: 'Follow Up',
        })
      }
      await writeZoho(forms)
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" 
      onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget }}
      onClick={(e) => { if (downOnBackdrop.current && e.target === e.currentTarget) onClose() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={touch ? 'Edit visit' : 'Log visit'}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl border border-line bg-panel p-5 sm:max-w-md sm:rounded-card"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="text-[15px] font-bold">{touch ? 'Edit visit' : 'Log visit'}</div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-10 w-10 place-items-center rounded-[10px] text-muted hover:bg-hoverbg">✕</button>
        </div>

        {promoting ? (
          <ZohoPromote prospectId={promoting.prospect_id} touch={promoting} onDone={() => onClose()} />
        ) : (<>
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
              <button type="button" onClick={() => {
                  setBusiness(null)
                  setForm((f) => ({ ...f, contactName: '', role: '', phone: '', email: '' }))
                }} className="text-[12px] text-muted hover:text-[color:var(--text)]">Change</button>
            )}
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className={`${LABEL} min-w-0`}>Visit date<input type="date" className={INPUT} value={form.dayKey} onChange={set('dayKey')} /></label>
          <label className={`${LABEL} min-w-0`}>Follow-up date<input type="date" className={INPUT} value={form.followUpOn} onChange={set('followUpOn')} /></label>
          <label className={`${LABEL} min-w-0`}>Contact name<input className={INPUT} value={form.contactName} onChange={set('contactName')} /></label>
          <label className={`${LABEL} min-w-0`}>Role<input className={INPUT} value={form.role} onChange={set('role')} /></label>
          <label className={`${LABEL} min-w-0`}>Phone<input type="tel" className={INPUT} value={form.phone} onChange={set('phone')} /></label>
          <label className={`${LABEL} min-w-0`}>Email<input type="email" className={INPUT} value={form.email} onChange={set('email')} /></label>
        </div>
        <label className={`${LABEL} mt-3`}>Notes<textarea rows={3} className={INPUT} value={form.notes} onChange={set('notes')} /></label>
        <label className={`${LABEL} mt-3`}>Next step<input className={INPUT} value={form.nextStep} onChange={set('nextStep')} /></label>

        <div className="mt-3">
          <div className={LABEL}>Prospect quality</div>
          <div role="group" aria-label="Prospect quality" className="flex gap-2">
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

        {canPromote && (
          <div className="mt-3">
            <label className="flex min-h-[40px] items-center gap-2 text-[13px] font-semibold">
              <input
                type="checkbox"
                checked={zohoOn}
                disabled={promo.forced}
                aria-describedby={promo.forced ? 'zoho-forced-hint' : undefined}
                onChange={(e) => setZohoChoice(e.target.checked)}
              />
              Add to Zoho as Open
            </label>
            {promo.forced && <div id="zoho-forced-hint" className="text-[12px] text-muted">Statement or later always goes to Zoho</div>}
          </div>
        )}

        {problem && <div role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{problem}</div>}

        <div className="mt-4 flex gap-2">
          {touch && (
            <button type="button" disabled={saving} onClick={remove} className="min-h-[44px] rounded-[10px] border border-line2 px-4 text-[13px] text-muted">Delete</button>
          )}
          <button type="button" disabled={saving} onClick={save} className="btn-primary min-h-[44px] flex-1 rounded-[10px] text-[14px] font-semibold">
            {saving ? 'Saving…' : 'Save visit'}
          </button>
        </div>
        </>)}
      </div>
    </div>
  )
}
