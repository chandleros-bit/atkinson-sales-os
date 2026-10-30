// The agents on a Tuesday loan (dialer phase 3): the buyer's and seller's
// agents from the borrower's FUB Relationships. AgentLines is the compact
// view under a theme-list row; AgentCalls is the dialer's block, where each
// agent can be called, texted, and the call logged.
//
// Logging: an agent matched to a Realtor contact with a phone gets a real
// call on their own record (it counts toward their Monday / Friday rhythm);
// anyone else is logged as a note on the borrower.
import { useState } from 'react'
import PersonLink from './PersonLink'
import { AGENT_LABEL } from '../lib/loanAgents'
import { formatPhone, telHref } from '../lib/phone'
import { textFor, smsHref } from '../lib/dialTexts'
import { invokeCrmAction } from '../lib/writeback'
import { buildActionRequest, summarizeResult } from '../lib/crmActions'

const quiet = 'min-h-[36px] rounded-[10px] border border-line2 px-2.5 text-[12.5px] font-semibold text-[#344054]'
const OUTCOMES = [
  { key: 'no_answer', label: 'No answer', crm: 'No Answer', note: 'no answer' },
  { key: 'voicemail', label: 'Voicemail', crm: 'Left Message', note: 'left voicemail' },
  { key: 'talked', label: 'Talked', crm: 'Interested', note: 'talked' },
]

const phoneOf = (a) => a.phone || a.matched_phone || null
const nameLink = (a, className) => (
  <PersonLink id={a.matched_contact_id} url={a.matched_url} className={className}>{a.name || '(no name)'}</PersonLink>
)

// agents: this borrower's agents or undefined (not read yet). checked: FUB answered.
export function AgentLines({ agents, checked }) {
  if (!agents?.length) {
    return checked ? <div data-agents-missing className="mt-1 text-[12px] text-dim">Add agents in FUB</div> : null
  }
  return (
    <div className="mt-1 flex flex-col gap-0.5">
      {agents.map((a) => {
        const tel = telHref(phoneOf(a))
        return (
          <div key={a.id} data-agent-line className="flex min-w-0 items-center gap-1.5 text-[12.5px]">
            <span className="flex-none text-dim">{AGENT_LABEL[a.kind]}</span>
            {nameLink(a, 'min-w-0 truncate font-semibold')}
            {tel && <a href={tel} className="num ml-auto flex-none text-muted underline">{formatPhone(phoneOf(a))}</a>}
          </div>
        )
      })}
    </div>
  )
}

export default function AgentCalls({ agents, checked, borrowerId, borrowerName }) {
  const [logged, setLogged] = useState({})
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)

  const log = async (a, o) => {
    const asCall = a.matched_contact_id && a.matched_phone
    const request = asCall
      ? buildActionRequest({ action: 'log_call', contactId: a.matched_contact_id, outcome: o.crm, nextStep: 'scheduled' })
      : buildActionRequest({ action: 'add_note', contactId: borrowerId, body: `Called ${AGENT_LABEL[a.kind].toLowerCase()} ${a.name || ''}: ${o.note}`.replace(/\s+:/, ':') })
    setBusy(a.id)
    setError(null)
    const summary = summarizeResult(await invokeCrmAction(request), 'bay')
    setBusy(null)
    if (summary.tone === 'error') return setError({ id: a.id, text: summary.text })
    setLogged((m) => ({ ...m, [a.id]: o.label }))
  }

  return (
    <section data-agent-calls className="mt-4 border-t border-line pt-3">
      <div className="text-[12px] font-semibold text-dim">Agents on this loan</div>
      {!agents?.length && <div className="mt-1 text-[12.5px] text-muted">{checked ? 'Add agents in FUB' : 'Checking FUB…'}</div>}
      {(agents || []).map((a) => {
        const phone = phoneOf(a)
        const text = textFor('bay', 'agent_update', a.name, { borrower: borrowerName })
        return (
          <div key={a.id} data-agent className="mt-2.5">
            <div className="flex min-w-0 items-baseline gap-1.5 text-[13px]">
              <span className="flex-none text-dim">{AGENT_LABEL[a.kind]}</span>
              {nameLink(a, 'min-w-0 truncate font-semibold')}
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span className="num text-[14px] font-semibold">{formatPhone(phone) || 'No phone'}</span>
              {telHref(phone) && <a href={telHref(phone)} className={`${quiet} ml-auto grid place-items-center`}>Call</a>}
              {smsHref(phone, text) && <a href={smsHref(phone, text)} className={`${quiet} grid place-items-center ${telHref(phone) ? '' : 'ml-auto'}`}>Text</a>}
            </div>
            {logged[a.id] ? (
              <div className="mt-1.5 text-[12.5px] text-muted">Logged: {logged[a.id]}</div>
            ) : (
              <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                {OUTCOMES.map((o) => (
                  <button key={o.key} type="button" disabled={busy != null} className={quiet} onClick={() => log(a, o)}>{o.label}</button>
                ))}
              </div>
            )}
            {error?.id === a.id && <div role="alert" className="mt-1 text-[12px]" style={{ color: 'var(--neg-ink)' }}>{error.text}</div>}
          </div>
        )
      })}
    </section>
  )
}
