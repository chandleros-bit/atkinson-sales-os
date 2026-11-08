// Labeled text box for the Reference calculators. Values stay strings; the
// calculators parse them with parseAmount.
export default function Field({ label, value, onChange, type = 'text', placeholder, suffix, className = '' }) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="mb-0.5 block text-micro font-medium text-muted">{label}</span>
      <span className="flex items-center gap-1">
        <input
          aria-label={label}
          type={type}
          inputMode={type === 'text' ? 'decimal' : undefined}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="w-full min-w-0 rounded-lg border border-line2 bg-panel2 px-2.5 py-1.5 text-body outline-none"
        />
        {suffix && <span className="flex-none text-caption text-muted">{suffix}</span>}
      </span>
    </label>
  )
}

export function Out({ k, label, children, tone }) {
  return (
    <div className="rounded-lg bg-panel2 px-3 py-2">
      <div className="text-micro text-muted">{label}</div>
      <div data-out={k} className="num text-lead font-semibold" style={tone ? { color: tone } : undefined}>
        {children}
      </div>
    </div>
  )
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
