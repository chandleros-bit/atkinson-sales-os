import { useState } from 'react'
import { useReferenceLinks } from '../../lib/useReferenceLinks'
import { groupLinks, lookupUrls, isHttpUrl, GROUP_ORDER } from '../../lib/referenceLinks'
import { Sheet } from '../QuickActions'
import Field, { copyText } from './Field'

// Reference > Links (spec section 7): an address lookup (HAR, Maps, Zillow in
// the link; copy for sites that need a login or have no search link) and
// pinned tiles that Chandler and Shelby both edit.
const TONE = { accent: 'var(--text)' }
const TILE = 'inline-flex items-center rounded-lg border border-line2 px-3 py-1.5 text-body hover:bg-hoverbg'

function LinkForm({ initial, onSave, onClose, error }) {
  const [f, setF] = useState(initial ? { ...initial } : { title: '', url: 'https://', grp: GROUP_ORDER[0], copy_address: false })
  const [problem, setProblem] = useState(null)
  const save = () => {
    if (!f.title.trim()) return setProblem('Enter a title.')
    if (!isHttpUrl(f.url)) return setProblem('Start the URL with https://')
    if (!f.grp.trim()) return setProblem('Enter a group.')
    setProblem(null)
    onSave({ ...f, title: f.title.trim(), url: f.url.trim(), grp: f.grp.trim() })
  }
  return (
    <Sheet title={initial ? `Edit ${initial.title}` : 'Add link'} t={TONE} onClose={onClose}>
      <div className="flex flex-col gap-2">
        <Field label="Title" value={f.title} onChange={(v) => setF((s) => ({ ...s, title: v }))} />
        <Field label="URL" value={f.url} onChange={(v) => setF((s) => ({ ...s, url: v }))} />
        <Field label="Group" value={f.grp} onChange={(v) => setF((s) => ({ ...s, grp: v }))} />
        <label className="flex items-center gap-2 text-body">
          <input type="checkbox" checked={!!f.copy_address} onChange={(e) => setF((s) => ({ ...s, copy_address: e.target.checked }))} />
          Show under &quot;Copy address&quot; in the lookup
        </label>
      </div>
      {(problem || error) && <div className="mt-2 text-caption text-neg-ink">{problem || error}</div>}
      <button type="button" aria-label="Save link" onClick={save} className="btn-primary mt-3 rounded-lg px-4 py-2 text-body font-semibold">
        Save
      </button>
    </Sheet>
  )
}

export default function LinksTab({ initialAddress = '' }) {
  const { rows, loading, error, save, remove, move } = useReferenceLinks()
  const [address, setAddress] = useState(initialAddress)
  const [editMode, setEditMode] = useState(false)
  const [editing, setEditing] = useState(undefined)
  const [copied, setCopied] = useState(false)
  const groups = groupLinks(rows)
  const copySites = rows.filter((r) => r.copy_address)
  const urls = lookupUrls(address)
  const has = address.trim().length > 0

  return (
    <div className="flex flex-col gap-4">
      <div className="cc-card flex flex-col gap-2 p-3">
        <div className="text-micro font-semibold uppercase tracking-wide text-dim">Address lookup</div>
        <input
          aria-label="Property address"
          placeholder="Street, city, state zip"
          value={address}
          onChange={(e) => {
            setAddress(e.target.value)
            setCopied(false)
          }}
          className="rounded-lg border border-line2 bg-panel2 px-2.5 py-1.5 text-body outline-none"
        />
        {has && (
          <div className="flex flex-wrap items-center gap-2">
            <a aria-label="Search HAR" href={urls.har} target="_blank" rel="noreferrer" className={TILE}>
              HAR
            </a>
            <a aria-label="Search Google Maps" href={urls.maps} target="_blank" rel="noreferrer" className={TILE}>
              Google Maps
            </a>
            <a aria-label="Search Zillow" href={urls.zillow} target="_blank" rel="noreferrer" className={TILE}>
              Zillow
            </a>
            <button type="button" className={TILE} onClick={async () => setCopied(await copyText(address.trim()))}>
              {copied ? 'Copied' : 'Copy address'}
            </button>
          </div>
        )}
        {has && copySites.length > 0 && (
          <div data-copy-sites className="flex flex-wrap items-center gap-2 text-caption text-muted">
            Then paste it into:
            {copySites.map((s) => (
              <a key={s.id} href={s.url} target="_blank" rel="noreferrer" className="text-link">
                {s.title} ↗
              </a>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <div className="text-micro font-semibold uppercase tracking-wide text-dim">Quick links</div>
        <div className="flex gap-3 text-body">
          {editMode && (
            <button type="button" aria-label="Add link" onClick={() => setEditing(null)} className="font-semibold text-link">
              + Add link
            </button>
          )}
          <button type="button" aria-label="Edit links" aria-pressed={editMode} onClick={() => setEditMode((e) => !e)} className="text-muted">
            {editMode ? 'Done' : 'Edit'}
          </button>
        </div>
      </div>
      {error && <div className="text-caption text-neg-ink">{error}</div>}
      {loading && <div className="text-body text-muted">Loading links…</div>}
      {groups.map(({ grp, links }) => (
        <section key={grp} data-link-group={grp}>
          <div className="mb-1.5 text-caption font-semibold text-muted">{grp}</div>
          <div className="flex flex-wrap gap-2">
            {links.map((l) =>
              editMode ? (
                <span key={l.id} className={`${TILE} gap-2`}>
                  <button type="button" aria-label={`Edit ${l.title}`} onClick={() => setEditing(l)}>
                    {l.title}
                  </button>
                  <button type="button" aria-label={`Move ${l.title} up`} onClick={() => move(l, links, -1)} className="text-dim">
                    ↑
                  </button>
                  <button type="button" aria-label={`Move ${l.title} down`} onClick={() => move(l, links, 1)} className="text-dim">
                    ↓
                  </button>
                  <button type="button" aria-label={`Delete ${l.title}`} onClick={() => window.confirm(`Delete ${l.title}?`) && remove(l.id)} className="text-neg-ink">
                    ×
                  </button>
                </span>
              ) : (
                <a key={l.id} data-link={l.title} href={l.url} target="_blank" rel="noreferrer" className={TILE}>
                  {l.title}
                </a>
              ),
            )}
          </div>
        </section>
      ))}
      {editing !== undefined && (
        <LinkForm
          initial={editing}
          error={error}
          onClose={() => setEditing(undefined)}
          onSave={async (row) => {
            const sort = row.id ? row.sort : Math.max(0, ...rows.filter((r) => r.grp === row.grp).map((r) => r.sort)) + 1
            if (await save({ ...row, sort })) setEditing(undefined)
          }}
        />
      )}
    </div>
  )
}
