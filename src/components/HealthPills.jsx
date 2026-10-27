// A lead's health as tinted pills (healthPills in cardHealth.js): speed to
// lead or the next step, then stuck days. The words always carry the meaning;
// the tint only makes the worst ones easy to spot.
import { healthPills } from '../lib/cardHealth'

export const PILL_TONE = {
  neg: { background: 'var(--neg-bg)', color: 'var(--neg-ink)' },
  warn: { background: 'var(--warn-bg)', color: 'var(--warn-ink)' },
  pos: { background: 'var(--pos-bg)', color: 'var(--pos-ink)' },
  neutral: { background: 'var(--panel2)', color: 'var(--muted)' },
}

export function Pill({ tone = 'neutral', className = '', children, ...rest }) {
  return (
    <span
      className={`inline-block max-w-full truncate rounded-full px-2 py-[2px] text-[11px] font-semibold ${className}`}
      style={PILL_TONE[tone]}
      {...rest}
    >
      {children}
    </span>
  )
}

export default function HealthPills({ h, className = '' }) {
  const pills = healthPills(h)
  if (!pills.length) return null
  return (
    <div className={`flex flex-wrap gap-1 ${className}`}>
      {pills.map((p) => (
        <Pill key={p.key} tone={p.tone} data-health={p.key} data-late={p.key === 'speed' ? String(p.late) : undefined}>
          {p.text}
        </Pill>
      ))}
    </div>
  )
}
