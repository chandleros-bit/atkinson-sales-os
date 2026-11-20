// Power Dialer (spec 2026-11-20): the Lists screen and the CSV upload. A card
// opens the dial screen (DialScreen); Ready to Push and Settings are linked
// from the header. Follows the All / MPG / Bayway switch. Archived lists are
// hidden unless "Show archived" is on; their call history stays for reporting.
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import BizBadge from '../components/BizBadge'
import DialerUpload from '../components/DialerUpload'
import { useBusiness } from '../context/BusinessContext'
import { useAuth } from '../context/AuthContext'
import { fetchLists, queueCount, setListStatus } from '../lib/dialerData'
import { isDemoMode } from '../lib/supabase'

const fmtDay = (iso) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Not dialed yet'
const headerLink = 'flex min-h-[40px] items-center gap-2 rounded-lg border border-line2 px-3 text-body font-semibold'

function ListCard({ list, onStatus }) {
  const pct = list.dialable ? Math.round((list.worked / list.dialable) * 100) : 0
  const color = list.business_id === 'mpg' ? 'var(--mpg)' : 'var(--bay)'
  const archived = list.status === 'archived'
  return (
    <li data-list-id={list.id} className={`flex overflow-hidden rounded-card border border-line bg-panel ${archived ? 'opacity-70' : ''}`}>
      <span aria-hidden="true" className="w-1 flex-none" style={{ background: color }} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Link to={`/dialer/${list.id}`} aria-label={`Dial ${list.name}`} className="flex flex-col gap-2 p-3 pb-2 hover:bg-hoverbg">
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-ui font-semibold">{list.name}</span>
            <BizBadge biz={list.business_id} />
            {list.temperature && (
              <span className="rounded-md border border-line2 px-1.5 text-micro font-bold uppercase tracking-wide text-ink2">{list.temperature}</span>
            )}
            {archived && <span className="rounded-md bg-panel2 px-1.5 text-micro font-bold uppercase tracking-wide text-muted">Archived</span>}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-panel2" role="progressbar" aria-label="Worked" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-muted">
            <span data-stat="worked" className="num">{list.worked} / {list.dialable} worked</span>
            <span data-stat="confirmed" className="num">{list.confirmed} confirmed</span>
            <span data-stat="last">{fmtDay(list.last_dialed_at)}</span>
          </div>
        </Link>
        <div className="flex justify-end px-3 pb-2">
          <button type="button" onClick={() => onStatus(list, archived ? 'active' : 'archived')}
            className="min-h-[32px] px-1 text-caption font-semibold text-muted hover:text-[color:var(--text)]">
            {archived ? 'Unarchive' : 'Archive'}
          </button>
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
  const [waiting, setWaiting] = useState(0)
  const [showArchived, setShowArchived] = useState(false)

  const load = useCallback(async () => {
    const { data, error: err } = await fetchLists()
    if (err) setError(err.message || String(err))
    else { setError(null); setLists(data) }
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { queueCount().then(setWaiting) }, [])

  async function changeStatus(list, status) {
    const { error: err } = await setListStatus(list.id, status)
    if (err) { setError(err.message); return }
    setLists((ls) => ls.map((l) => (l.id === list.id ? { ...l, status } : l)))
  }

  const inBook = (lists || []).filter((l) => biz === 'all' || l.business_id === biz)
  const archivedCount = inBook.filter((l) => l.status === 'archived').length
  const shown = inBook.filter((l) => showArchived || l.status !== 'archived')

  return (
    <div className="flex flex-col gap-4 pt-4">
      <PageHeader
        title="Power Dialer"
        subtitle="Upload a list, work it one call at a time. Nothing reaches Zoho or FUB until you approve it."
        actions={
          <>
            <Link to="/dialer/queue" data-queue-link className={headerLink}>
              Ready to Push
              {waiting > 0 && <span className="rounded-full bg-[color:var(--text)] px-1.5 text-micro font-semibold leading-[17px] text-white">{waiting}</span>}
            </Link>
            <Link to="/dialer/settings" data-settings-link className={headerLink}>Settings</Link>
            {!uploading && (
              <button type="button" onClick={() => setUploading(true)} className="min-h-[40px] rounded-lg bg-[color:var(--text)] px-4 text-body font-semibold text-white">
                Upload CSV
              </button>
            )}
          </>
        }
      />

      {uploading && (
        <DialerUpload
          defaultBiz={biz}
          userId={session?.user?.id}
          onCancel={() => setUploading(false)}
          onSaved={() => { setUploading(false); load() }}
        />
      )}

      {isDemoMode && <p className="text-body text-muted">Demo mode: a sample list to try the dial screen. Uploads can be mapped and checked but not saved.</p>}
      {error && <div role="alert" className="rounded-lg border border-neg-line bg-neg-bg px-3 py-2 text-body text-neg-ink">Couldn't load lists: {error}</div>}

      {lists && !shown.length && !uploading && (
        <div className="rounded-card border border-line bg-panel px-6 py-10 text-center text-sm text-muted">
          No call lists yet. Upload a CSV to start dialing.
        </div>
      )}
      {shown.length > 0 && (
        <ul aria-label="Call lists" className="grid gap-3 sm:grid-cols-2">
          {shown.map((l) => <ListCard key={l.id} list={l} onStatus={changeStatus} />)}
        </ul>
      )}
      {archivedCount > 0 && (
        <button type="button" data-show-archived onClick={() => setShowArchived((v) => !v)} className="self-start text-body font-semibold text-muted">
          {showArchived ? 'Hide archived lists' : `Show archived lists (${archivedCount})`}
        </button>
      )}
    </div>
  )
}
