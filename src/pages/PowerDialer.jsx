// Power Dialer (spec 2026-11-20): the Lists screen and the CSV upload. The
// dial screen, push queue and settings arrive in later phases. Follows the
// All / MPG / Bayway switch; archived lists are hidden.
import { useCallback, useEffect, useState } from 'react'
import PageHeader from '../components/PageHeader'
import BizBadge from '../components/BizBadge'
import DialerUpload from '../components/DialerUpload'
import { useBusiness } from '../context/BusinessContext'
import { useAuth } from '../context/AuthContext'
import { fetchLists } from '../lib/dialerData'
import { isDemoMode } from '../lib/supabase'

const fmtDay = (iso) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Not dialed yet'

function ListCard({ list }) {
  const pct = list.dialable ? Math.round((list.worked / list.dialable) * 100) : 0
  const color = list.business_id === 'mpg' ? 'var(--mpg)' : 'var(--bay)'
  return (
    <li data-list-id={list.id} className="flex overflow-hidden rounded-card border border-line bg-panel">
      <span aria-hidden="true" className="w-1 flex-none" style={{ background: color }} />
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-ui font-semibold">{list.name}</span>
          <BizBadge biz={list.business_id} />
          {list.temperature && (
            <span className="rounded-md border border-line2 px-1.5 text-micro font-bold uppercase tracking-wide text-ink2">{list.temperature}</span>
          )}
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-panel2" role="progressbar" aria-label="Worked" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-muted">
          <span data-stat="worked" className="num">{list.worked} / {list.dialable} worked</span>
          <span data-stat="confirmed" className="num">{list.confirmed} confirmed</span>
          <span data-stat="last">{fmtDay(list.last_dialed_at)}</span>
        </div>
      </div>
    </li>
  )
}

export default function PowerDialer() {
  const { biz } = useBusiness()
  const { session } = useAuth() || {}
  const [lists, setLists] = useState(null)
  const [error, setError] = useState(null)
  const [uploading, setUploading] = useState(false)

  const load = useCallback(async () => {
    const { data, error: err } = await fetchLists()
    if (err) setError(err.message || String(err))
    else { setError(null); setLists(data) }
  }, [])
  useEffect(() => { load() }, [load])

  const shown = (lists || []).filter((l) => l.status !== 'archived' && (biz === 'all' || l.business_id === biz))

  return (
    <div className="flex flex-col gap-4 pt-4">
      <PageHeader
        title="Power Dialer"
        subtitle="Upload a list, work it one call at a time. Nothing reaches Zoho or FUB until you approve it."
        actions={!uploading && (
          <button type="button" onClick={() => setUploading(true)} className="min-h-[40px] rounded-lg bg-[color:var(--text)] px-4 text-body font-semibold text-white">
            Upload CSV
          </button>
        )}
      />

      {uploading && (
        <DialerUpload
          defaultBiz={biz}
          userId={session?.user?.id}
          onCancel={() => setUploading(false)}
          onSaved={() => { setUploading(false); load() }}
        />
      )}

      {isDemoMode && <p className="text-body text-muted">Demo mode: lists can be mapped and checked but not saved.</p>}
      {error && <div role="alert" className="rounded-lg border border-neg-line bg-neg-bg px-3 py-2 text-body text-neg-ink">Couldn't load lists: {error}</div>}

      {lists && !shown.length && !uploading && (
        <div className="rounded-card border border-line bg-panel px-6 py-10 text-center text-sm text-muted">
          No call lists yet. Upload a CSV to start dialing.
        </div>
      )}
      {shown.length > 0 && (
        <ul aria-label="Call lists" className="grid gap-3 sm:grid-cols-2">
          {shown.map((l) => <ListCard key={l.id} list={l} />)}
        </ul>
      )}
    </div>
  )
}
