// How far a Bayway lead is from New Lead to Application Received, as five
// segments (stageProgress in pipeline.js). Nothing for stages off that path
// (Nurture, Lost, MPG statuses).
import { stageProgress } from '../lib/pipeline'

export default function StageProgress({ stage, label = false, className = '' }) {
  const p = stageProgress(stage)
  if (!p) return null
  return (
    <div className={`flex items-center gap-2 ${className}`} data-stage-step={p.step} title={`${stage}: step ${p.step} of ${p.of}`}>
      {label && <span className="truncate text-[11px] text-muted">{stage}</span>}
      <div className="flex flex-none gap-[3px]" role="img" aria-label={`Step ${p.step} of ${p.of}`}>
        {Array.from({ length: p.of }, (_, i) => (
          <span
            key={i}
            className="h-[5px] w-[14px] rounded-full"
            style={{ background: i < p.step ? 'var(--bay)' : 'var(--line2)' }}
          />
        ))}
      </div>
    </div>
  )
}
