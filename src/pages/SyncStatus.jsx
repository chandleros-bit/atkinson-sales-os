import { useEffect, useState, useCallback } from 'react'
import { supabase, isDemoMode } from '../lib/supabase'

const SOURCE_LABELS = {
  fub: { label: 'FollowUpBoss (Bayway)', biz: 'bay' },
  'fub-webhook': { label: 'FollowUpBoss webhook (Bayway)', biz: 'bay' },
  'fub-activity': { label: 'FollowUpBoss activity (Bayway)', biz: 'bay' },
  'fub-tasks': { label: 'FollowUpBoss tasks (Bayway)', biz: 'bay' },
  zoho: { label: 'Zoho CRM (MPG)', biz: 'mpg' },
  'zoho-tasks': { label: 'Zoho tasks (MPG)', biz: 'mpg' },
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

export default function SyncStatus() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(!isDemoMode)
  const [error, setError] = useState(null)
  const [running, setRunning] = useState(false)

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
            className="rounded-lg border border-line2 px-3 py-1.5 text-xs font-semibold text-muted hover:text-white disabled:opacity-50"
          >
            {running ? 'Running…' : 'Run FollowUpBoss sync now'}
          </button>
        )}
      </div>
      <p className="mt-1 text-sm text-muted">
        Per-source health for FollowUpBoss, Zoho, and both Outlook calendars. Read-only — this
        page shows what synced in, it never writes back to any source.
      </p>

      {isDemoMode && (
        <div className="mt-6 rounded-card border border-line bg-panel px-6 py-8 text-center text-sm text-muted">
          Demo mode — connect Supabase to see live sync health here.
        </div>
      )}

      {!isDemoMode && error && (
        <div className="mt-4 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
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
                    <div className="mt-1 truncate text-[11.5px] text-red-300/80">{row.message}</div>
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

      {!isDemoMode && loading && (
        <div className="mt-6 text-sm text-muted">Loading sync history…</div>
      )}
    </div>
  )
}
