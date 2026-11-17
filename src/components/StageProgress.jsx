// How far a lead is along its book's path, one segment per step
// (stageProgress in pipeline.js): Bayway New Lead to Application Received,
// MPG Not Contacted to Approved. Nothing for stages off the path (Nurture,
// Lost, Closed Non-Compatible).
import { stageProgress } from '../lib/pipeline'

export default function StageProgress({ stage, label = false, className = '' }) {
  const p = stageProgress(stage)
  if (!p) return null
  return (
    <div className={`flex items-center gap-2 ${className}`} data-stage-step={p.step} title={`${stage}: step ${p.step} of ${p.of}`}>
      {label && <span className="truncate text-micro text-muted">{stage}</span>}
      <div className="flex flex-none gap-[3px]" role="img" aria-label={`Step ${p.step} of ${p.of}`}>
        {Array.from({ length: p.of }, (_, i) => (
          <span
            key={i}
            className="h-[5px] w-[14px] rounded-full"
            style={{ background: i < p.step ? (p.book === 'mpg' ? 'var(--mpg)' : 'var(--bay)') : 'var(--line2)' }}
          />
        ))}
      </div>
    </div>
  )
}
