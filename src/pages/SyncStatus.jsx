import { useEffect, useState, useCallback } from 'react'
import { supabase, isDemoMode } from '../lib/supabase'
import { summarizeWriteback } from '../lib/crmActions'

const SOURCE_LABELS = {
  fub: { label: 'FollowUpBoss (Bayway)', biz: 'bay' },
  'fub-webhook': { label: 'FollowUpBoss webhook (Bayway)', biz: 'bay' },
  'fub-activity': { label: 'FollowUpBoss activity (Bayway)', biz: 'bay' },
  'fub-tasks': { label: 'FollowUpBoss tasks (Bayway)', biz: 'bay' },
  zoho: { label: 'Zoho CRM (MPG)', biz: 'mpg' },
  'zoho-tasks': { label: 'Zoho tasks (MPG)', biz: 'mpg' },
  'zoho-activity': { label: 'Zoho activity (MPG)', biz: 'mpg' },
  'outlook-mpg': { label: 'Outlook — MPG', biz: 'mpg' },
  'outlook-bayway': { label: 'Outlook — Bayway', biz: 'bay' },
}

function timeAgo(iso) {
  if (!iso) return 'never'
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

// Quick Actions write-back health (crm_actions, last 24 hours).
function WritebackRow({ wb }) {
  const failed = wb.error + wb.partial
  const total = wb.ok + wb.partial + wb.error + wb.refused + wb.pending
  const dotColor = total === 0 ? 'var(--dim)' : failed ? '#e8785f' : 'var(--bay)'
  return (
    <div className="mt-4 rounded-card border border-line bg-panel">
      <div className="flex items-center gap-3 px-4 py-3.5">
        <span
          className="h-2 w-2 flex-none rounded-full"
          style={{ background: dotColor, boxShadow: `0 0 0 4px ${dotColor}22` }}
        />
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold">Write-back (Quick Actions)</div>
          <div className="mt-0.5 text-[12px] text-muted">
            Last 24h: {wb.ok} ok · {wb.partial} partial · {wb.error} failed
            {wb.refused ? ` · ${wb.refused} refused` : ''}
          </div>
          {wb.latestError && (
            <div className="mt-1 truncate text-[11.5px] text-red-700/80">
              Latest problem ({timeAgo(wb.latestError.at)}): {wb.latestError.text}
            </div>
          )}
        </div>
        <div className="num text-right text-[12.5px] text-muted">{wb.lastAt ? timeAgo(wb.lastAt) : 'none yet'}</div>
      </div>
    </div>
  )
}

export default function SyncStatus() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(!isDemoMode)
  const [error, setError] = useState(null)
  const [running, setRunning] = useState(false)
  const [writeback, setWriteback] = useState(null)

  const load = useCallback(async () => {
    if (isDemoMode) return
    setLoading(true)
    setError(null)
    // Latest row per source: pull recent history and reduce client-side
    // rather than a DISTINCT ON query, so we can also show a short trail.
    const { data, error: err } = await supabase
      .from('sync_log')
      .select('source, ran_at, status, records_upserted, message')
      .order('ran_at', { ascending: false })
      .limit(200)

    if (err) {
      setError(err.message)
      setLoading(false)
      return
    }

    const latestBySource = new Map()
    for (const row of data || []) {
      if (!latestBySource.has(row.source)) latestBySource.set(row.source, row)
    }
    setRows([...latestBySource.values()])

    // Quick Actions write-back: last 24 hours of crm_actions. A failed read
    // (e.g. before migration 0028) just hides the row.
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    const wb = await supabase
      .from('crm_actions')
      .select('status, results, created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(500)
    setWriteback(wb.error ? null : summarizeWriteback(wb.data))
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const runNow = async () => {
    setRunning(true)
    try {
      await supabase.functions.invoke('fub-sync')
    } catch (e) {
      setError(e.message)
    }
    await load()
    setRunning(false)
  }

  const knownSources = Object.keys(SOURCE_LABELS)
  const bySource = new Map(rows.map((r) => [r.source, r]))

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-[26px] font-bold tracking-tight">Sync Status</h2>
        {!isDemoMode && (
          <button
            onClick={runNow}
            disabled={running}
            className="rounded-lg border border-line2 px-3 py-1.5 text-xs font-semibold text-muted hover:text-[color:var(--text)] disabled:opacity-50"
          >
            {running ? 'Running…' : 'Run FollowUpBoss sync now'}
          </button>
        )}
      </div>
      <p className="mt-1 text-sm text-muted">
        Per-source health for FollowUpBoss, Zoho, and both Outlook calendars. The source rows show what synced in;
        the Write-back row shows Quick Actions sent to FollowUpBoss and Zoho.
      </p>

      {isDemoMode && (
        <div className="mt-6 rounded-card border border-line bg-panel px-6 py-8 text-center text-sm text-muted">
          Demo mode — connect Supabase to see live sync health here.
        </div>
      )}

      {!isDemoMode && error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {!isDemoMode && !loading && (
        <div className="mt-5 rounded-card border border-line bg-panel">
          {knownSources.map((source, i) => {
            const meta = SOURCE_LABELS[source]
            const row = bySource.get(source)
            const ok = row?.status === 'ok'
            const dotColor = !row ? 'var(--dim)' : ok ? 'var(--bay)' : '#e8785f'
            return (
              <div
                key={source}
                className={`flex items-center gap-3 px-4 py-3.5 ${
                  i < knownSources.length - 1 ? 'border-b border-line' : ''
                }`}
              >
                <span
                  className="h-2 w-2 flex-none rounded-full"
                  style={{ background: dotColor, boxShadow: `0 0 0 4px ${dotColor}22` }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[13.5px] font-semibold">
                    {meta.label}
                    <span
                      className="rounded px-1.5 py-px text-[9.5px] font-bold"
                      style={{
                        color: meta.biz === 'mpg' ? 'var(--mpg)' : 'var(--bay)',
                        background: meta.biz === 'mpg' ? 'var(--mpg-soft)' : 'var(--bay-soft)',
                      }}
                    >
                      {meta.biz === 'mpg' ? 'MPG' : 'BAYWAY'}
                    </span>
                  </div>
                  {row?.message && !ok && (
                    <div className="mt-1 truncate text-[11.5px] text-red-700/80">{row.message}</div>
                  )}
                  {!row && (
                    <div className="mt-1 text-[11.5px] text-dim">
                      Not connected yet — see docs/phase2-fub-setup.md
                    </div>
                  )}
                </div>
                {row && (
                  <div className="text-right">
                    <div className="num text-[12.5px] text-muted">{timeAgo(row.ran_at)}</div>
                    <div className="num text-[11px] text-dim">{row.records_upserted} synced</div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {!isDemoMode && !loading && writeback && <WritebackRow wb={writeback} />}

      {!isDemoMode && loading && (
        <div className="mt-6 text-sm text-muted">Loading sync history…</div>
      )}
    </div>
  )
}
