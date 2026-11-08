import { useMemo, useState } from 'react'
import { useReferenceLenders } from '../../lib/useReferenceLenders'
import { Sheet } from '../QuickActions'
import Field from './Field'
import { parseAmount } from '../../lib/calc/parse'
import { formatPhone } from '../../lib/phone'

// Reference > Lenders (spec section 6): one AE directory for Chandler and
// Shelby, comp notes included. Delete is real (reference data, no history).
export const PROGRAMS = ['Bank statement', 'DSCR', 'ITIN', 'Foreign national', 'Non-warrantable condo', 'Conventional', 'FHA', 'VA']
const TONE = { accent: 'var(--text)' }
const shortDate = (iso) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' }).format(new Date(iso))
const firstName = (n) => String(n || '').trim().split(/\s+/)[0]
const EMPTY = { lender: '', ae_name: '', ae_phone: '', ae_email: '', portal_url: '', programs: '', min_fico: '', max_ltv: '', turn_time: '', comp_notes: '', notes: '' }

function toForm(row) {
  if (!row) return EMPTY
  const f = { ...EMPTY }
  for (const k of Object.keys(EMPTY)) f[k] = row[k] ?? ''
  f.programs = (row.programs || []).join(', ')
  return f
}

function LenderForm({ initial, onSave, onDelete, onClose, error }) {
  const [f, setF] = useState(() => toForm(initial))
  const [problem, setProblem] = useState(null)
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }))
  const text = (v) => String(v ?? '').trim() || null
  const save = () => {
    if (!String(f.lender).trim()) {
      setProblem('Enter the lender name.')
      return
    }
    setProblem(null)
    onSave({
      id: initial?.id,
      lender: String(f.lender).trim(),
      ae_name: text(f.ae_name),
      ae_phone: text(f.ae_phone),
      ae_email: text(f.ae_email),
      portal_url: text(f.portal_url),
      programs: String(f.programs).split(',').map((p) => p.trim()).filter(Boolean),
      min_fico: parseAmount(f.min_fico),
      max_ltv: parseAmount(f.max_ltv),
      turn_time: text(f.turn_time),
      comp_notes: text(f.comp_notes),
      notes: text(f.notes),
    })
  }
  return (
    <Sheet title={initial ? `Edit ${initial.lender}` : 'Add lender'} t={TONE} onClose={onClose}>
      <div className="grid grid-cols-2 gap-2">
        <Field className="col-span-2" label="Lender" value={f.lender} onChange={set('lender')} />
        <Field label="AE name" value={f.ae_name} onChange={set('ae_name')} />
        <Field label="AE phone" value={f.ae_phone} onChange={set('ae_phone')} />
        <Field className="col-span-2" label="AE email" value={f.ae_email} onChange={set('ae_email')} />
        <Field className="col-span-2" label="Portal URL" value={f.portal_url} onChange={set('portal_url')} />
        <Field className="col-span-2" label="Programs" value={f.programs} onChange={set('programs')} placeholder={PROGRAMS.slice(0, 3).join(', ')} />
        <Field label="Min FICO" value={f.min_fico} onChange={set('min_fico')} />
        <Field label="Max LTV %" value={f.max_ltv} onChange={set('max_ltv')} />
        <Field className="col-span-2" label="Turn time" value={f.turn_time} onChange={set('turn_time')} />
        <Field className="col-span-2" label="Comp and pricing" value={f.comp_notes} onChange={set('comp_notes')} />
        <label className="col-span-2 block">
          <span className="mb-0.5 block text-micro font-medium text-muted">Notes</span>
          <textarea aria-label="Notes" rows={3} value={f.notes} onChange={(e) => set('notes')(e.target.value)} className="w-full rounded-lg border border-line2 bg-panel2 px-2.5 py-1.5 text-body outline-none" />
        </label>
      </div>
      {(problem || error) && <div className="mt-2 text-caption text-neg-ink">{problem || error}</div>}
      <div className="mt-3 flex items-center gap-2">
        <button type="button" aria-label="Save lender" onClick={save} className="btn-primary rounded-lg px-4 py-2 text-body font-semibold">
          Save
        </button>
        {initial && (
          <button type="button" aria-label="Delete lender" onClick={() => window.confirm(`Delete ${initial.lender}?`) && onDelete(initial.id)} className="ml-auto text-body text-neg-ink">
            Delete
          </button>
        )}
      </div>
    </Sheet>
  )
}

export default function LendersTab() {
  const { rows, loading, error, save, remove } = useReferenceLenders()
  const [q, setQ] = useState('')
  const [program, setProgram] = useState(null)
  const [editing, setEditing] = useState(undefined) // undefined closed, null new, row edit

  const programs = useMemo(() => [...new Set([...PROGRAMS, ...rows.flatMap((r) => r.programs || [])])], [rows])
  const needle = q.trim().toLowerCase()
  const shown = rows.filter((r) => {
    const text = `${r.lender} ${r.ae_name || ''} ${r.notes || ''} ${r.comp_notes || ''}`.toLowerCase()
    return (!needle || text.includes(needle)) && (!program || (r.programs || []).includes(program))
  })

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="Search lenders" placeholder="Search lender, AE or notes" value={q} onChange={(e) => setQ(e.target.value)} className="min-w-[200px] flex-1 rounded-lg border border-line2 bg-panel2 px-2.5 py-1.5 text-body outline-none" />
        <button type="button" aria-label="Add lender" onClick={() => setEditing(null)} className="rounded-lg border border-line2 px-3 py-1.5 text-body font-semibold">
          + Add lender
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {programs.map((p) => (
          <button
            key={p}
            type="button"
            aria-label={`Filter ${p}`}
            aria-pressed={program === p}
            onClick={() => setProgram(program === p ? null : p)}
            className={`rounded-full border px-2.5 py-0.5 text-caption ${program === p ? 'border-[color:var(--text)] font-semibold' : 'border-line2 text-muted'}`}
          >
            {p}
          </button>
        ))}
      </div>
      {error && <div className="text-caption text-neg-ink">{error}</div>}
      {loading ? (
        <div className="text-body text-muted">Loading lenders…</div>
      ) : shown.length === 0 ? (
        <div className="text-body text-muted">{rows.length ? 'No lenders match.' : 'No lenders yet. Add your first AE.'}</div>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((r) => (
            <li key={r.id} data-lender={r.lender} className="cc-card flex flex-col gap-1 p-3 text-body">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold">{r.lender}</span>
                <button type="button" aria-label={`Edit ${r.lender}`} onClick={() => setEditing(r)} className="text-caption text-link">
                  Edit
                </button>
              </div>
              <div className="text-muted">
                {[r.ae_name, (r.programs || []).join(', '), r.min_fico ? `${r.min_fico}+ FICO` : null, r.max_ltv ? `${r.max_ltv}% LTV max` : null, r.turn_time].filter(Boolean).join(' · ')}
              </div>
              {r.comp_notes && <div>Comp: {r.comp_notes}</div>}
              {r.notes && <div className="whitespace-pre-line text-muted">{r.notes}</div>}
              <div className="flex flex-wrap items-center gap-3 text-body">
                {r.ae_phone && (
                  <a href={`tel:${r.ae_phone}`} className="text-link">
                    Call {formatPhone(r.ae_phone)}
                  </a>
                )}
                {r.ae_email && (
                  <a href={`mailto:${r.ae_email}`} className="text-link">
                    Email
                  </a>
                )}
                {r.portal_url && (
                  <a href={r.portal_url} target="_blank" rel="noreferrer" className="text-link">
                    Portal ↗
                  </a>
                )}
                {r.updated_at && (
                  <span className="ml-auto text-caption text-dim">
                    Updated {shortDate(r.updated_at)}
                    {r.updated_by_name ? ` · ${firstName(r.updated_by_name)}` : ''}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing !== undefined && (
        <LenderForm
          initial={editing}
          error={error}
          onClose={() => setEditing(undefined)}
          onSave={async (row) => (await save(row)) && setEditing(undefined)}
          onDelete={async (id) => (await remove(id)) && setEditing(undefined)}
        />
      )}
    </div>
  )
}
