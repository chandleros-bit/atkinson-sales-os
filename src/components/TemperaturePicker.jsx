// Rate or re-rate a lead from the Person sheet. Tapping a temperature saves at
// once; the amount (Bayway) and close month save with Save.
// saveRating also sets the FUB tag for Bayway.
import { useState } from 'react'
import { TEMPERATURES, TEMP_LABEL, closeMonthOf } from '../lib/leadRatings'
import { saveRating } from '../lib/useLeadRatings'
import { showToast } from './Toaster'

const monthOptions = (now = Date.now()) =>
  Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now)
    d.setDate(1)
    d.setMonth(d.getMonth() + i)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
    return { key, label: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) }
  })

export default function TemperaturePicker({ contactId, businessId, rating, onSaved }) {
  const [amount, setAmount] = useState(rating?.est_amount ? String(rating.est_amount) : '')
  const [month, setMonth] = useState(rating ? closeMonthOf(rating) : '')
  const [busy, setBusy] = useState(false)

  const save = async (temperature, args) => {
    setBusy(true)
    const res = await saveRating({ contactId, businessId, temperature, ...args })
    setBusy(false)
    if (!res.ok) showToast({ tone: 'error', text: `Temperature not saved: ${res.error}` })
    else if (res.tagError) showToast({ tone: 'error', text: `Temperature saved; FUB tag not updated: ${res.tagError}` })
    else onSaved?.(temperature)
  }

  // saveRating: undefined leaves a saved value alone, null clears it.
  // Tapping a temperature: the same one keeps the chosen month, a different one
  // resets the month (null) to that temperature's default. The amount in the
  // field goes with it; an empty field clears the amount for Cold and leaves a
  // saved one alone for Hot / Warm. MPG has no amount, so it is never sent.
  const tap = (k) => {
    const same = rating?.temperature === k
    let estAmount
    if (businessId === 'bay') estAmount = amount ? Number(amount) : k === 'cold' ? null : undefined
    save(k, { estAmount, closeMonth: same ? month || null : null })
  }
  // Save: the field is the truth, so a field cleared on purpose clears the amount.
  const saveFields = () =>
    save(rating.temperature, { estAmount: businessId === 'bay' ? (amount ? Number(amount) : null) : undefined, closeMonth: month || null })

  return (
    <div className="flex flex-col gap-2" data-temperature-picker>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Temperature">
        {TEMPERATURES.map((k) => (
          <button
            key={k}
            type="button"
            disabled={busy}
            aria-pressed={rating?.temperature === k}
            onClick={() => tap(k)}
            className={`min-h-[36px] rounded-[10px] border px-3 text-[12.5px] font-semibold ${
              rating?.temperature === k ? 'border-[color:var(--text)] text-[color:var(--text)]' : 'border-line2 text-muted'
            }`}
          >
            {TEMP_LABEL[k]}
          </button>
        ))}
      </div>
      {rating && (
        <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
          {businessId === 'bay' && rating.temperature !== 'cold' && (
            <input
              aria-label="Estimated loan amount"
              inputMode="numeric"
              placeholder="Est. loan amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))}
              className="w-36 rounded-[10px] border border-line2 bg-panel px-2 py-1.5"
            />
          )}
          <select aria-label="Expected close month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-[10px] border border-line2 bg-panel px-2 py-1.5">
            {monthOptions().map((o) => (
              <option key={o.key} value={o.key}>
                Closes {o.label}
              </option>
            ))}
          </select>
          <button type="button" disabled={busy} onClick={saveFields} className="rounded-[10px] border border-line2 px-3 py-1.5 font-semibold">
            Save
          </button>
        </div>
      )}
    </div>
  )
}
