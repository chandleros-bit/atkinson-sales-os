// Tune-up (Bayway Bot Engine doc, learning loop). The Friday tune-up bot
// proposes at most 3 changes per bot with the evidence; approve to commit the
// change to the bayway-bots repo (rollback-able), or reject. Below: each bot's
// no-edit approval rate by week, flagged when it drops.
import { useCallback, useEffect, useState } from 'react'
import PageHeader from '../components/PageHeader'
import { showToast } from '../components/Toaster'
import { isDemoMode } from '../lib/supabase'
import { friendlyError } from '../lib/friendlyError'
import { loadChanges, loadApprovalRows, approvalTable, decideChange, syncRepo, commitUrl, botLabel } from '../lib/tuneUp'

const BTN = 'min-h-[36px] rounded-lg border border-line2 px-3 font-medium hover:bg-hoverbg disabled:opacity-50'

function Proposal({ c, onDone }) {
  const [busy, setBusy] = useState(false)
  const decide = async (d) => {
    setBusy(true)
    try {
      const res = await decideChange(c, d)
      if (!res.ok) showToast({ tone: 'error', text: res.error })
      else if (d === 'approved') showToast({ tone: 'ok', text: `Committed as ${botLabel(c.bot)} v${res.version}` })
      onDone()
    } catch (e) {
      showToast({ tone: 'error', text: friendlyError(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <article data-change={c.id} className="cc-card flex flex-col gap-2 p-4 text-body">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{botLabel(c.bot)}</span>
        <span className="text-muted">· {c.kind === 'lesson' ? 'New lesson' : 'Instruction edit'} · {c.file_path}</span>
        {c.status === 'failed' && <span className="rounded-full border border-neg-line px-2 text-xs text-neg-ink">Failed: {c.error}</span>}
      </div>
      <div className="font-medium">{c.summary}</div>
      {c.kind === 'lesson' ? (
        <p className="rounded-lg bg-hoverbg px-3 py-2">{c.lesson}</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <pre className="whitespace-pre-wrap rounded-lg bg-hoverbg px-3 py-2 font-sans text-muted line-through">{c.old_text}</pre>
          <pre className="whitespace-pre-wrap rounded-lg bg-hoverbg px-3 py-2 font-sans">{c.new_text}</pre>
        </div>
      )}
      <p className="text-muted"><span className="font-medium text-[color:var(--text)]">Evidence:</span> {c.evidence}</p>
      <div className="flex gap-2">
        <button type="button" data-approve onClick={() => decide('approved')} disabled={busy} className={`${BTN} font-semibold`}>{c.status === 'failed' ? 'Retry' : 'Approve and commit'}</button>
        <button type="button" data-reject onClick={() => decide('rejected')} disabled={busy} className={BTN}>Reject</button>
      </div>
    </article>
  )
}

export default function TuneUp() {
  const [changes, setChanges] = useState(null)
  const [rates, setRates] = useState(null)
  const [syncing, setSyncing] = useState(false)

  const reload = useCallback(async () => {
    try {
      const [c, r] = await Promise.all([loadChanges(), loadApprovalRows()])
      setChanges(c)
      setRates(approvalTable(r))
    } catch (e) {
      setChanges([])
      setRates(approvalTable([]))
      showToast({ tone: 'error', text: friendlyError(e) })
    }
  }, [])
  useEffect(() => { reload() }, [reload])

  const sync = async () => {
    setSyncing(true)
    const res = await syncRepo()
    setSyncing(false)
    showToast(res?.ok ? { tone: 'ok', text: `Synced ${res.synced} bot files from GitHub` } : { tone: 'error', text: res?.error || 'Sync failed' })
  }

  const open = (changes || []).filter((c) => c.status === 'proposed' || c.status === 'failed')
  const history = (changes || []).filter((c) => c.status === 'applied' || c.status === 'rejected').slice(0, 30)

  return (
    <div className="flex flex-col gap-4 pt-4">
      <PageHeader eyebrow="Bayway" title="Tune-up" subtitle="The Friday tune-up's proposed bot changes, and how often you approve each bot's drafts untouched."
        actions={<button type="button" onClick={sync} disabled={syncing || isDemoMode} className={BTN}>{syncing ? 'Syncing…' : 'Sync bot files'}</button>} />
      {isDemoMode && <p className="text-body text-muted">Connect Supabase to see the tune-up.</p>}
      {!isDemoMode && changes === null && <p className="text-body text-muted">Loading…</p>}
      {!isDemoMode && changes && (
        <>
          <h2 className="text-lead font-semibold">Proposals ({open.length})</h2>
          {open.length ? open.map((c) => <Proposal key={c.id} c={c} onDone={reload} />) : <p className="text-body text-muted">No proposals waiting. The tune-up runs Fridays at 3:15 PM.</p>}

          <h2 className="mt-2 text-lead font-semibold">Approval rate (approved with no edits)</h2>
          {rates.bots.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-body">
                <thead>
                  <tr className="text-left text-xs text-dim">
                    <th className="py-1 pr-3">Bot</th>
                    {rates.weeks.map((w) => <th key={w} className="pr-3 text-right">{w.slice(5)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rates.bots.map((b) => (
                    <tr key={b.bot} data-rate-bot={b.bot} className="border-t border-line">
                      <td className="py-1.5 pr-3">{botLabel(b.bot)}{b.dropped && <span data-dropped className="ml-2 text-xs text-warn-ink">dropped</span>}</td>
                      {b.cells.map((c, i) => <td key={i} className="num pr-3 text-right">{c ? (c.rate == null ? '' : `${c.rate}%`) : ''}{c && <div className="text-xs text-dim">{c.decided} drafts</div>}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-body text-muted">No decided drafts yet. Rates start once bots write drafts and you approve or skip them.</p>
          )}

          {history.length > 0 && (
            <>
              <h2 className="mt-2 text-lead font-semibold">Change log</h2>
              <ul className="flex flex-col gap-1 text-body">
                {history.map((c) => (
                  <li key={c.id} data-history={c.id}>
                    <span className="text-muted">{String(c.decided_at || c.created_at).slice(0, 10)}</span>{' '}
                    {botLabel(c.bot)} {c.status === 'applied' ? `v${c.version}` : '(rejected)'}: {c.summary}
                    {c.commit_sha && <> · <a href={commitUrl(c.commit_sha)} target="_blank" rel="noreferrer" className="text-link">commit</a></>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  )
}
