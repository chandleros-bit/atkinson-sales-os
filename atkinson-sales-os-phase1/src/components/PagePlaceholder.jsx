import { useBusiness } from '../context/BusinessContext'

// Stub screen used for routes that land in later phases.
export default function PagePlaceholder({ title, phase, biz, children }) {
  const accent =
    biz === 'mpg' ? 'var(--mpg)' : biz === 'bay' ? 'var(--bay)' : 'var(--dim)'

  return (
    <div>
      <div className="flex items-center gap-3">
        <h2 className="text-[26px] font-bold tracking-tight">{title}</h2>
        {biz && (
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide"
            style={{
              color: accent,
              background: biz === 'mpg' ? 'var(--mpg-soft)' : 'var(--bay-soft)',
            }}
          >
            {biz === 'mpg' ? 'MPG' : 'BAYWAY'}
          </span>
        )}
      </div>
      <div className="mt-5 rounded-card border border-line bg-panel px-6 py-10 text-center">
        <p className="text-sm text-muted">
          This screen lands in <span className="font-semibold text-white">Phase {phase}</span>.
        </p>
        {children && <p className="mx-auto mt-2 max-w-md text-[12.5px] text-dim">{children}</p>}
      </div>
    </div>
  )
}
