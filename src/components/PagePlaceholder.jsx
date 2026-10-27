import PageHeader from './PageHeader'

// Stub screen used for routes that land in later phases.
export default function PagePlaceholder({ title, phase, biz, children }) {
  const accent =
    biz === 'mpg' ? 'var(--mpg-ink)' : biz === 'bay' ? 'var(--bay-ink)' : 'var(--dim)'

  return (
    <div>
      <PageHeader
        eyebrow={biz === 'mpg' ? 'MPG · Zoho' : biz === 'bay' ? 'Bayway · FollowUpBoss' : undefined}
        eyebrowColor={biz ? accent : undefined}
        title={title}
      />
      <div className="mt-5 rounded-card border border-line bg-panel px-6 py-10 text-center">
        <p className="text-sm text-muted">
          This screen lands in <span className="font-semibold text-[color:var(--text)]">Phase {phase}</span>.
        </p>
        {children && <p className="mx-auto mt-2 max-w-md text-[12.5px] text-dim">{children}</p>}
      </div>
    </div>
  )
}
