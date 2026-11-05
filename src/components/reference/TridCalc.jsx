import { useState } from 'react'
import Field, { Out } from './Field'
import { tridDates } from '../../lib/calc/trid'
import { chicagoDateKey } from '../../lib/briefingTime'

const nice = (key) =>
  key ? new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${key}T00:00:00Z`)) : '-'
const valid = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))

export default function TridCalc() {
  const [application, setApplication] = useState(chicagoDateKey(Date.now()))
  const [mailed, setMailed] = useState(false)
  const [closing, setClosing] = useState('')
  const t = valid(application) ? tridDates({ application, mailed, closing: valid(closing) ? closing : null }) : null

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Field label="Application date" type="date" value={application} onChange={setApplication} />
        <label className="block">
          <span className="mb-0.5 block text-[11px] font-medium text-muted">Delivery</span>
          <select aria-label="Delivery" value={mailed ? 'mail' : 'hand'} onChange={(e) => setMailed(e.target.value === 'mail')} className="w-full rounded-[8px] border border-line2 bg-panel2 px-2 py-1.5 text-[13px]">
            <option value="hand">In person or email</option>
            <option value="mail">Mailed</option>
          </select>
        </label>
        <Field label="Planned closing (optional)" type="date" value={closing} onChange={setClosing} />
      </div>
      {t && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Out k="leBy" label="Loan Estimate must go out by">{nice(t.leBy)}</Out>
          <Out k="leReceived" label="Loan Estimate counts as received">{nice(t.leReceived)}</Out>
          <Out k="earliestClosing" label="Earliest closing">{nice(t.earliestClosing)}</Out>
          {t.cdReceiveBy && <Out k="cdReceiveBy" label="Closing Disclosure received by">{nice(t.cdReceiveBy)}</Out>}
          {t.cdReceiveBy && mailed && <Out k="cdSendBy" label="Closing Disclosure mailed by">{nice(t.cdSendBy)}</Out>}
        </div>
      )}
      <p className="text-[12px] text-muted">Planning dates. The lender&apos;s disclosure system is the official record.</p>
    </div>
  )
}
