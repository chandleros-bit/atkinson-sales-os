// A lead's health as tinted pills (healthPills in cardHealth.js): speed to
// lead or the next step, then stuck days. The words always carry the meaning;
// the tint only makes the worst ones easy to spot.
import { healthPills } from '../lib/cardHealth'

export const PILL_TONE = {
  neg: { background: 'var(--neg-bg)', color: 'var(--neg-ink)', borderColor: 'var(--neg-line)' },
  warn: { background: 'var(--warn-bg)', color: 'var(--warn-ink)', borderColor: 'var(--warn-line)' },
  pos: { background: 'var(--pos-bg)', color: 'var(--pos-ink)', borderColor: 'var(--pos-line)' },
  neutral: { background: 'var(--panel2)', color: 'var(--muted)', borderColor: 'var(--line2)' },
}

export function Pill({ tone = 'neutral', className = '', children, ...rest }) {
  return (
    <span
      className={`inline-block max-w-full truncate rounded-md border px-2 py-[1px] text-[11.5px] font-semibold ${className}`}
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
