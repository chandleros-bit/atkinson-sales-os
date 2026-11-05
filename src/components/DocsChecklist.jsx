import { useEffect, useState } from 'react'
import { useBorrowerDocs } from '../lib/useBorrowerDocs'
import { docRows, docSummary, cleanDocName, MAX_DOC_NAME } from '../lib/docChecklist'

// Person sheet > Loan > Docs: Needed / Received per doc, remove, add, one note.
// Owner and assistant alike (Bayway only; the RPCs enforce it).
const LABEL = 'mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-dim'

function Seg({ name, status, onPick, busy }) {
  const base = 'px-2 py-0.5 text-[11.5px]'
  return (
    <div className="flex flex-none overflow-hidden rounded-[7px] border border-line2">
      <button
        type="button"
        disabled={busy}
        aria-label={`Mark ${name} needed`}
        aria-pressed={status === 'needed'}
        onClick={() => status !== 'needed' && onPick('needed')}
        className={`${base} ${status === 'needed' ? 'bg-[#fffaeb] font-semibold text-[#b54708]' : 'text-muted'}`}
      >
        Needed
      </button>
      <button
        type="button"
        disabled={busy}
        aria-label={`Mark ${name} received`}
        aria-pressed={status === 'received'}
        onClick={() => status !== 'received' && onPick('received')}
        className={`${base} border-l border-line2 ${status === 'received' ? 'bg-[#ecfdf3] font-semibold text-[#067647]' : 'text-muted'}`}
      >
        Received
      </button>
    </div>
  )
}

export default function DocsChecklist({ contactId, onChange }) {
  const d = useBorrowerDocs(contactId)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [nameError, setNameError] = useState(null)

  useEffect(() => {
    setNote(d.note || '')
  }, [d.note])

  const run = async (fn) => {
    setBusy(true)
    const ok = await fn()
    setBusy(false)
    if (ok) onChange?.()
    return ok
  }

  if (d.loading) return <div className="text-[12.5px] text-muted">Loading docs…</div>

  if (!d.tracked) {
    return (
      <div>
        <div className={LABEL}>Docs</div>
        <div className="mb-2 text-[12.5px] text-muted">Docs not set up.</div>
        <button type="button" aria-label="Set up docs" disabled={busy} onClick={() => run(d.setup)} className="rounded-[8px] border border-line2 px-3 py-1.5 text-[12.5px] font-semibold">
          Set up docs
        </button>
        {d.error && <div className="mt-2 text-[12px] text-[#b42318]">{d.error}</div>}
      </div>
    )
  }

  const rows = docRows(d.docs)
  const sum = docSummary(d.docs)
  const add = async () => {
    const clean = cleanDocName(name)
    if (!clean) {
      setNameError(`Enter a doc name (up to ${MAX_DOC_NAME} characters).`)
      return
    }
    setNameError(null)
    if (await run(() => d.setDoc(clean, 'needed'))) setName('')
  }

  return (
    <div>
      <div className={LABEL}>
        Docs · {sum.needed} of {sum.total} needed{sum.oldestDays != null ? ` · oldest ${sum.oldestDays}d` : ''}
      </div>
      <ul className="flex flex-col">
        {rows.map((r) => (
          <li key={r.id} data-doc={r.name} data-doc-status={r.status} className="flex items-center gap-2 border-b border-line py-1.5 text-[13px]">
            <span className="min-w-0 flex-1 truncate">{r.name}</span>
            {r.chase ? (
              <span data-chase className="flex-none rounded-[6px] bg-[#fef3f2] px-1.5 text-[11.5px] text-[#b42318]">
                {r.label} · chase
              </span>
            ) : (
              <span className="num flex-none text-[11.5px] text-dim">{r.label}</span>
            )}
            <Seg name={r.name} status={r.status} busy={busy} onPick={(s) => run(() => d.setDoc(r.name, s))} />
            <button type="button" aria-label={`Remove ${r.name}`} disabled={busy} onClick={() => run(() => d.setDoc(r.name, 'removed'))} className="flex-none px-1 text-[14px] text-dim hover:text-[color:var(--text)]">
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex gap-2">
        <input
          aria-label="New doc name"
          placeholder="Add a doc, e.g. Gift letter"
          value={name}
          maxLength={MAX_DOC_NAME + 20}
          onChange={(e) => {
            setName(e.target.value)
            setNameError(null)
          }}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          className="min-w-0 flex-1 rounded-[8px] border border-line2 bg-panel2 px-2.5 py-1.5 text-[12.5px] outline-none"
        />
        <button type="button" aria-label="Add doc" disabled={busy} onClick={add} className="flex-none rounded-[8px] border border-line2 px-3 text-[12.5px] font-semibold">
          Add
        </button>
      </div>
      {nameError && <div className="mt-1 text-[12px] text-[#b42318]">{nameError}</div>}
      <div className={`${LABEL} mt-3`}>Doc note</div>
      <textarea
        aria-label="Doc note"
        value={note}
        rows={2}
        maxLength={500}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => note.trim() !== (d.note || '') && run(() => d.setNote(note))}
        className="w-full rounded-[8px] border border-line2 bg-panel2 px-2.5 py-1.5 text-[12.5px] outline-none"
      />
      {d.error && <div className="mt-1 text-[12px] text-[#b42318]">{d.error}</div>}
    </div>
  )
}
