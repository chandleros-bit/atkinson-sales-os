// The one filter control inside pages: a light segmented switch. (The navy
// All / MPG / Bayway switch in the top bar is the business filter; underline
// tabs - SectionTabs, Reports' periods - move between views.)
// options: [[key, label], ...]. Buttons carry aria-pressed inside a labelled
// group, so a screen reader hears "YTD, pressed".
export default function Segmented({ label, options, value, onChange, size = 'md', className = '' }) {
  const sm = size === 'sm'
  return (
    <div role="group" aria-label={label} className={`inline-flex max-w-full flex-none overflow-x-auto rounded-lg bg-panel2 p-[3px] ${className}`}>
      {options.map(([k, text]) => {
        const on = value === k
        return (
          <button
            key={k}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(k)}
            className={`flex-none whitespace-nowrap rounded-md ${sm ? 'min-h-[26px] px-2.5 text-caption' : 'min-h-[32px] px-3 text-body'} ${
              on ? 'bg-panel font-semibold text-[color:var(--text)] shadow-sm' : 'font-medium text-muted hover:text-[color:var(--text)]'
            }`}
          >
            {text}
          </button>
        )
      })}
    </div>
  )
}
