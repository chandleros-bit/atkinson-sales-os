// Rate or re-rate a lead from the Person sheet. Tapping a temperature saves at
// once; the amount (Bayway) and close month save with Save.
// saveRating also sets the FUB tag for Bayway.
//
// The month select starts on the RAW saved close_month. '' is "Default": the
// lead is unpinned and follows the temperature's default month (the forecast's
// offsets), so a save never pins a month the user did not choose.
import { useState } from 'react'
import { TEMPERATURES, TEMP_LABEL, defaultCloseMonth } from '../lib/leadRatings'
import { saveRating } from '../lib/useLeadRatings'
import { useForecast } from '../lib/useForecastInputs'
import { showToast } from './Toaster'

const keyOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
const labelOf = (key) => new Date(`${key}T12:00:00`).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

// The next 7 months, plus a saved month outside them (kept selectable so the
// select never shows a value it cannot hold). A past one is marked.
const monthOptions = (saved, now = Date.now()) => {
  const opts = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now)
    d.setDate(1)
    d.setMonth(d.getMonth() + i)
    const key = keyOf(d)
    return { key, label: labelOf(key) }
  })
  if (saved && !opts.some((o) => o.key === saved)) {
    opts.unshift({ key: saved, label: `${labelOf(saved)}${saved < opts[0].key ? ' (past)' : ''}` })
  }
  return opts
}

// An amount counts only when it is a positive number.
const positive = (v) => (Number(v) > 0 ? Number(v) : null)

export default function TemperaturePicker({ contactId, businessId, rating, onSaved }) {
  const { settings } = useForecast()
  const [amount, setAmount] = useState(rating?.est_amount ? String(rating.est_amount) : '')
  const [month, setMonth] = useState(rating?.close_month ? String(rating.close_month).slice(0, 10) : '')
  const [busy, setBusy] = useState(false)

  const save = async (temperature, args) => {
    setBusy(true)
    const res = await saveRating({ contactId, businessId, temperature, ...args })
    setBusy(false)
    if (!res.ok) showToast({ tone: 'error', text: `Temperature not saved: ${res.error}` })
    else if (res.tagError) showToast({ tone: 'error', text: `Temperature saved; FUB tag not updated: ${res.tagError}` })
    else {
      showToast({ tone: 'ok', text: 'Temperature saved' })
      onSaved?.(temperature)
    }
  }

  // saveRating: undefined leaves a saved value alone, null clears it.
  // Tapping a temperature: the same one sends the chosen month ('' = Default =
  // null); a different one resets the month (null) to that temperature's default.
  // Bayway Hot / Warm send the field amount when it is positive, else leave the
  // saved one alone. Cold never touches the amount (Log call does the same),
  // and neither does MPG, which has no amount.
  const tap = (k) => {
    const same = rating?.temperature === k
    const estAmount = businessId === 'bay' && k !== 'cold' ? positive(amount) ?? undefined : undefined
    save(k, { estAmount, closeMonth: same ? month || null : null })
  }
  // Save: the field is the truth, so a field cleared on purpose clears the amount.
  const saveFields = () =>
    save(rating.temperature, { estAmount: businessId === 'bay' ? positive(amount) : undefined, closeMonth: month || null })

  return (
    <div className="flex flex-col gap-2" data-temperature-picker>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Lead temperature">
        {TEMPERATURES.map((k) => (
          <button
            key={k}
            type="button"
            disabled={busy}
            aria-pressed={rating?.temperature === k}
            onClick={() => tap(k)}
            className={`min-h-[36px] rounded-lg border px-3 text-body font-semibold ${
              rating?.temperature === k ? 'border-[color:var(--text)] text-[color:var(--text)]' : 'border-line2 text-muted'
            }`}
          >
            {TEMP_LABEL[k]}
          </button>
        ))}
      </div>
      {rating && (
        <div className="flex flex-wrap items-center gap-2 text-body">
          {businessId === 'bay' && rating.temperature !== 'cold' && (
            <input
              aria-label="Estimated loan amount"
              inputMode="numeric"
              placeholder="Est. loan amount"
              value={amount}
              maxLength={12}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))}
              className="w-36 rounded-lg border border-line2 bg-panel px-2 py-1.5"
            />
          )}
          <select aria-label="Expected close month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-lg border border-line2 bg-panel px-2 py-1.5">
            <option value="">Default ({labelOf(defaultCloseMonth(rating.temperature, Date.now(), settings?.close_offset_months))})</option>
            {monthOptions(month).map((o) => (
              <option key={o.key} value={o.key}>
                Closes {o.label}
              </option>
            ))}
          </select>
          <button type="button" disabled={busy} onClick={saveFields} className="rounded-lg border border-line2 px-3 py-1.5 font-semibold">
            Save
          </button>
        </div>
      )}
    </div>
  )
}
