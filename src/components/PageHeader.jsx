// The header every page shares: a small eyebrow (the sidebar group it lives
// in), the title with an optional inline note (a count, a Stale chip), a
// one-line subtitle, the page's own actions, and the sync dot.
import { Link } from 'react-router-dom'
import { isDemoMode } from '../lib/supabase'
import { syncHealth } from '../lib/syncHealth'
import { useSyncHealth } from '../lib/useSyncHealth'
import { useNow } from '../lib/useNow'

const DOT = { ok: 'var(--pos-ink)', stale: 'var(--warn-ink)', error: 'var(--neg-ink)', unknown: 'var(--dim)' }

export function SyncDot() {
  const latest = useSyncHealth()
  const now = useNow(60_000)
  if (isDemoMode || !latest) return null
  const h = syncHealth(latest, now)
  const title = h.detail.map((d) => `${d.label}: ${d.text}`).join('\n')
  return (
    <Link
      to="/sync"
      data-sync-state={h.state}
      title={title}
      aria-label={`${h.text}. Open Sync Status`}
      className="flex min-h-[32px] flex-none items-center gap-2 rounded-full border border-line bg-panel px-3 text-[12px] font-medium text-muted hover:text-[color:var(--text)]"
    >
      <span
        aria-hidden="true"
        className="h-2 w-2 flex-none rounded-full"
        style={{ background: DOT[h.state], boxShadow: `0 0 0 3px color-mix(in srgb, ${DOT[h.state]} 18%, transparent)` }}
      />
      <span className="num whitespace-nowrap">{h.text}</span>
    </Link>
  )
}

export default function PageHeader({ eyebrow, eyebrowColor, title, note, subtitle, actions }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        {eyebrow && (
          <div className="mb-1 text-[10.5px] font-semibold tracking-[1px]" style={{ color: eyebrowColor || 'var(--dim)' }}>
            {eyebrow}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="text-[22px] font-bold tracking-tight sm:text-[26px]">{title}</h2>
          {note}
        </div>
        {subtitle && <p className="mt-1 hidden text-sm text-muted sm:block">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {actions}
        <SyncDot />
      </div>
    </header>
  )
}
