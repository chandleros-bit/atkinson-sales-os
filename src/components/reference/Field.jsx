// Labeled text box for the Reference calculators. Values stay strings; the
// calculators parse them with parseAmount.
export default function Field({ label, value, onChange, type = 'text', placeholder, suffix, className = '' }) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="mb-0.5 block text-[11px] font-medium text-muted">{label}</span>
      <span className="flex items-center gap-1">
        <input
          aria-label={label}
          type={type}
          inputMode={type === 'text' ? 'decimal' : undefined}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="w-full min-w-0 rounded-[8px] border border-line2 bg-panel2 px-2.5 py-1.5 text-[13px] outline-none"
        />
        {suffix && <span className="flex-none text-[12px] text-muted">{suffix}</span>}
      </span>
    </label>
  )
}

export function Out({ k, label, children, tone }) {
  return (
    <div className="rounded-[10px] bg-panel2 px-3 py-2">
      <div className="text-[11px] text-muted">{label}</div>
      <div data-out={k} className="num text-[18px] font-semibold" style={tone ? { color: tone } : undefined}>
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
