// The header every page shares: an optional eyebrow (a book's pages name the
// book and its CRM), the title with an optional inline note (a count, a
// Stale chip), a one-line subtitle, the page's own actions, and the last-sync
// check. The desktop top bar above it carries the page name, the business
// switch and + New.
import { Link } from 'react-router-dom'
import { isDemoMode } from '../lib/supabase'
import { syncHealth } from '../lib/syncHealth'
import { useSyncHealth } from '../lib/useSyncHealth'
import { useNow } from '../lib/useNow'

const DOT = { ok: '#12B76A', stale: '#F79009', error: '#D92D20', unknown: '#98A2B3' }
const MARK = { ok: 'M7.5 12.5l3 3 6-6.5', stale: 'M12 7v6 M12 16.5v.5', error: 'M12 7v6 M12 16.5v.5', unknown: 'M8 12h8' }

export function SyncDot() {
  const latest = useSyncHealth()
  const now = useNow(60_000)
  if (isDemoMode || !latest) return null
  const h = syncHealth(latest, now)
  const title = h.detail.map((d) => `${d.label}: ${d.text}`).join('\n')
  const text = h.state === 'ok' ? h.text.replace(/^Synced /, 'Last sync: ') : h.text
  return (
    <Link
      to="/sync"
      data-sync-state={h.state}
      title={title}
      aria-label={`${h.text}. Open Sync Status`}
      className="flex min-h-[36px] flex-none items-center gap-2 rounded-[10px] px-1 text-[14px] text-[#344054] hover:text-[color:var(--text)]"
    >
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" className="flex-none text-dim">
        <path d="M4 6h16v15H4z M4 10h16 M8 3v4 M16 3v4" />
      </svg>
      <span className="num whitespace-nowrap">{text}</span>
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" className="flex-none">
        <circle cx="12" cy="12" r="10" fill={DOT[h.state]} />
        <path d={MARK[h.state]} stroke="#FFFFFF" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Link>
  )
}

export default function PageHeader({ eyebrow, eyebrowColor, title, note, subtitle, actions }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        {eyebrow && (
          <div className="mb-1 text-[14.5px] font-semibold" style={{ color: eyebrowColor || 'var(--dim)' }}>
            {eyebrow}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="text-[24px] font-semibold tracking-[-0.6px] sm:text-[32px]">{title}</h2>
          {note}
        </div>
        {subtitle && <p className="mt-1 hidden text-[15px] text-muted sm:block">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SyncDot />
        {actions}
      </div>
    </header>
  )
}
