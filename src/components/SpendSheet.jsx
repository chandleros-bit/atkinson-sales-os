import { useMemo, useRef, useState } from 'react'
import { Sheet } from './QuickActions'
import { sourceTable } from '../lib/analytics'
import { aliasMap, isFree, labelFor, lastMonths, sheetLabels, spendCells, spendChanges, mergeRows, freeRows } from '../lib/roi'
import { saveSpend, saveAliases, removeAliases } from '../lib/roiData'

// Spend sheet (spec 2026-11-05-lead-sources-roi-design.md, UI): monthly spend
// per source label for the last 12 months, free sources, and source merges.
// Saved spend comes from props (reloaded by the parent after every action);
// state holds only the user's edits, so a merge never leaves stale cells.
const BOOKS = { bay: { name: 'Bayway', accent: 'var(--bay)' }, mpg: { name: 'MPG', accent: 'var(--mpg)' } }
const BOOK_IDS = Object.keys(BOOKS)
const NO_EDITS = { bay: {}, mpg: {} }
const monthLabel = (m) => new Date(`${m}T12:00:00`).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }).replace(" '", ' ')
const BOX = 'w-[72px] rounded-[8px] border border-line2 bg-panel2 px-1.5 py-1 text-right text-[12.5px] outline-none'

export default function SpendSheet({ biz, leads, aliases, spend, onClose, onSaved, nowMs }) {
  const [now] = useState(() => nowMs ?? Date.now())
  const [book, setBook] = useState(biz === 'mpg' ? 'mpg' : 'bay')
  const [edits, setEdits] = useState(NO_EDITS)
  const [picked, setPicked] = useState([])
  const [mergeLabel, setMergeLabel] = useState('')
  const [problem, setProblem] = useState(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)

  const months = useMemo(() => lastMonths(12, now), [now])
  const map = useMemo(() => aliasMap(aliases), [aliases])
  const saved = useMemo(() => ({ bay: spendCells(spend, 'bay', map), mpg: spendCells(spend, 'mpg', map) }), [spend, map])
  const table = useMemo(() => sourceTable(leads, book, now - 365 * 86400000), [leads, book, now])
  const labels = sheetLabels(table, book, spend, map)
  const paid = labels.filter((l) => !isFree(l, book, map))
  const free = labels.filter((l) => isFree(l, book, map))
  const raws = [...new Set([...table.rows.map((r) => r.source), ...aliases.filter((a) => a.book === book).map((a) => a.raw)])].sort((a, b) => a.localeCompare(b))
  const merges = Object.entries(
    aliases
      .filter((a) => a.book === book && a.raw !== a.label)
      .reduce((acc, a) => ({ ...acc, [a.label]: [...(acc[a.label] || []), a] }), {}),
  )

  // Edits of every book vs saved spend -> one combined change set.
  const changes = () => {
    const upserts = []
    const deletes = []
    for (const b of BOOK_IDS) {
      const c = spendChanges(spend, b, edits[b], map)
      if (c.problem) return { book: b, problem: biz === 'all' ? `${BOOKS[b].name}: ${c.problem}` : c.problem }
      upserts.push(...c.upserts)
      deletes.push(...c.deletes)
    }
    return { upserts, deletes, problem: null }
  }

  const run = async (action, after) => {
    busyRef.current = true
    setBusy(true)
    try {
      const { error } = await action()
      if (error) return setProblem(error.message || String(error))
      setProblem(null)
      await onSaved()
      if (after) after()
    } catch (e) {
      setProblem(e?.message || String(e))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const saveGrid = () => {
    const c = changes()
    if (c.problem) {
      setBook(c.book)
      return setProblem(c.problem)
    }
    if (!c.upserts.length && !c.deletes.length) return onClose()
    return run(() => saveSpend({ upserts: c.upserts, deletes: c.deletes }), onClose)
  }

  // Backdrop, Escape and ✕: ignored mid-save; unsaved edits ask first.
  const close = () => {
    if (busyRef.current) return
    const c = changes()
    if ((c.problem || c.upserts.length || c.deletes.length) && !window.confirm('Discard unsaved spend?')) return
    onClose()
  }

  // A merge or unmerge moves cells between labels and changes saved sums, so
  // this book's edits are dropped rather than saved against the new grid.
  const clearEdits = (b) => setEdits((e) => ({ ...e, [b]: {} }))

  const merge = () => {
    if (picked.length < 2) return setProblem('Pick two or more sources to merge.')
    if (!mergeLabel.trim()) return setProblem('Enter a label for the merged sources.')
    return run(() => saveAliases(mergeRows(book, picked, mergeLabel, isFree(mergeLabel.trim(), book, map))), () => {
      clearEdits(book)
      setPicked([])
      setMergeLabel('')
    })
  }

  const setCell = (key, value) => setEdits((e) => ({ ...e, [book]: { ...e[book], [key]: value } }))

  const row = (label, isFreeRow) => (
    <tr key={label} data-spend-row={label}>
      <td className="sticky left-0 max-w-[140px] truncate bg-panel py-1 pr-2">{label}</td>
      <td className="px-1 text-center">
        <input type="checkbox" aria-label={`Free ${label}`} checked={isFreeRow} disabled={busy} onChange={() => run(() => saveAliases(freeRows(book, label, aliases, !isFreeRow)))} />
      </td>
      {months.map((m) => {
        const key = `${label}|${m}`
        return (
          <td key={m} className="px-1 py-0.5">
            <input aria-label={`${label} ${monthLabel(m)}`} inputMode="decimal" value={edits[book][key] ?? saved[book][key] ?? ''} onChange={(e) => setCell(key, e.target.value)} className={BOX} />
          </td>
        )
      })}
    </tr>
  )

  return (
    <Sheet title="Marketing spend" subtitle={`${BOOKS[book].name} · monthly, by source`} t={{ accent: BOOKS[book].accent }} onClose={close}>
      {biz === 'all' && (
        <div role="tablist" aria-label="Book" className="mb-3 flex gap-1 rounded-xl bg-panel2 p-1">
          {Object.entries(BOOKS).map(([id, b]) => (
            <button key={id} type="button" role="tab" aria-selected={book === id} onClick={() => setBook(id)} className={`flex-1 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold ${book === id ? 'bg-panel' : 'text-muted'}`}>
              {b.name}
            </button>
          ))}
        </div>
      )}

      <div className="-mx-5 overflow-x-auto px-5">
        <table className="text-[12.5px]">
          <thead>
            <tr className="text-[11px] text-muted">
              <th className="sticky left-0 bg-panel py-1 pr-2 text-left font-semibold">Source</th>
              <th className="px-1 font-semibold">Free</th>
              {months.map((m) => (
                <th key={m} className="px-1 text-right font-semibold">
                  {monthLabel(m)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paid.map((label) => row(label, false))}
            {free.length > 0 && (
              <tr>
                <td colSpan={months.length + 2} className="sticky left-0 bg-panel pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-dim">
                  Free sources
                </td>
              </tr>
            )}
            {free.map((label) => row(label, true))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 border-t border-line pt-3 text-[12.5px]">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-dim">Merge sources</div>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {raws.map((raw) => (
            <label key={raw} className="inline-flex items-center gap-1.5">
              <input type="checkbox" aria-label={`Merge ${raw}`} checked={picked.includes(raw)} onChange={() => setPicked((p) => (p.includes(raw) ? p.filter((x) => x !== raw) : [...p, raw]))} />
              {raw}
              {labelFor(raw, book, map) !== raw && <span className="text-dim">→ {labelFor(raw, book, map)}</span>}
            </label>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <input aria-label="Merged label" placeholder="Self-sourced" value={mergeLabel} onChange={(e) => setMergeLabel(e.target.value)} className="flex-1 rounded-[8px] border border-line2 bg-panel2 px-2.5 py-1.5 text-[13px] outline-none" />
          <button type="button" aria-label="Merge sources" disabled={busy} onClick={merge} className="rounded-[8px] border border-line2 px-3 py-1.5 font-semibold">
            Merge
          </button>
        </div>
        {merges.map(([label, rows]) => (
          <div key={label} className="mt-1.5 flex items-center gap-2 text-muted">
            <span>
              {label}: {rows.map((r) => r.raw).join(', ')}
            </span>
            <button type="button" aria-label={`Unmerge ${label}`} disabled={busy} onClick={() => run(() => removeAliases(rows.map((r) => r.id)), () => clearEdits(book))} className="text-[#1d4ed8]">
              Unmerge
            </button>
          </div>
        ))}
      </div>

      {problem && (
        <div role="alert" className="mt-3 text-[12px] text-[#b42318]">
          {problem}
        </div>
      )}
      <button type="button" aria-label="Save spend" disabled={busy} onClick={saveGrid} className="btn-primary mt-4 rounded-[10px] px-4 py-2 text-[13px] font-semibold">
        {busy ? 'Saving…' : 'Save'}
      </button>
    </Sheet>
  )
}
